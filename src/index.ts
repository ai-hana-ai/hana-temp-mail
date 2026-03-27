import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { Context, Hono } from 'hono';
import PostalMime from 'postal-mime';
import { renderHomePage } from './ui.tsx';
import { normalizeMailboxInput } from './validation';

export interface Env {
  DB: D1Database;
  MAIL_DOMAINS?: string;
  MAIL_DOMAIN?: string;
  RETENTION_DAYS?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  ENABLE_PASSKEY?: string;
  PASSKEY_RP_ID?: string;
  PASSKEY_RP_NAME?: string;
  SESSION_TTL_HOURS?: string;
}

type Bindings = { Bindings: Env };

type AuthUserRow = {
  id: string;
  mailbox: string;
};

type AuthCredentialRow = {
  id: string;
  credential_id: string | Uint8Array | ArrayBuffer;
  public_key: string | Uint8Array | ArrayBuffer;
  counter: number;
  user_id: string;
  transports: string | null;
};

type AuthChallengeRow = {
  id: string;
  user_id: string;
  challenge: string;
  flow: 'registration' | 'authentication';
};

type AuthSessionRow = {
  id: string;
  user_id: string;
  expires_at: string;
};

type AuthStatus = {
  enabled: boolean;
  hasOwner: boolean;
  authenticated: boolean;
};

// v2 deployment trigger for testing
const app = new Hono<Bindings>();
const rateLimitState = new Map<string, { count: number; resetAt: number }>();
let nextRateLimitCleanupAt = 0;
const SESSION_COOKIE = 'hana_session';
const textEncoder = new TextEncoder();
const OWNER_AUTH_MAILBOX = '__hana_owner__';

const RATE_LIMITS = {
  random: 24,
  inboxList: 60,
  emailDetail: 120,
  stream: 12,
  auth: 30,
} as const;

export function getMailDomains(env: Env): string[] {
  const raw = env.MAIL_DOMAINS || env.MAIL_DOMAIN || 'adopsee.com';
  return raw.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
}

export function getPrimaryMailDomain(env: Env): string {
  return getMailDomains(env)[0] || 'adopsee.com';
}

export function isPasskeyEnabled(env: Env): boolean {
  return String(env.ENABLE_PASSKEY || '')
    .trim()
    .toLowerCase() === 'true';
}

export function getPasskeyRpID(env: Env, requestUrl: string): string {
  const configured = (env.PASSKEY_RP_ID || '').trim().toLowerCase();
  if (configured) return configured;
  return new URL(requestUrl).hostname;
}

export function getPasskeyRpName(env: Env): string {
  const configured = (env.PASSKEY_RP_NAME || '').trim();
  return configured || 'Hana Temp Mail';
}

export function getPasskeyOrigin(requestUrl: string): string {
  return new URL(requestUrl).origin;
}

export function normalizeMailbox(input: string | null, mailDomains: string[]): string | null {
  if (!input) return null;
  
  const value = input.trim().toLowerCase();
  
  // Backward compatibility: If no @domain, assume primary domain
  if (!value.includes('@')) {
    const primaryDomain = mailDomains[0] || 'adopsee.com';
    return normalizeMailboxInput(value, primaryDomain);
  }

  const parts = value.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  
  if (!mailDomains.includes(domain)) return null;
  return normalizeMailboxInput(local, domain);
}

export function randomLocalPart(length = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function randomMailbox(mailDomain: string): string {
  return `${randomLocalPart()}@${mailDomain}`;
}

export function jsonError(c: Context<Bindings>, status: number, code: string, message: string) {
  return c.json({ error: message, code }, status);
}

export function getRateLimitWindowMs(env: Env): number {
  const raw = Number(env.RATE_LIMIT_WINDOW_MS || '');
  if (Number.isFinite(raw) && raw >= 1000) return raw;
  return 60_000;
}

export function getSessionTtlHours(env: Env): number {
  const raw = Number(env.SESSION_TTL_HOURS || '');
  if (Number.isFinite(raw) && raw >= 1 && raw <= 24 * 90) return Math.floor(raw);
  return 24 * 30;
}

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return 'unknown';
}

export function applyRateLimit(c: Context<Bindings>, bucket: keyof typeof RATE_LIMITS) {
  const windowMs = getRateLimitWindowMs(c.env);
  const limit = RATE_LIMITS[bucket];
  const now = Date.now();
  if (now >= nextRateLimitCleanupAt) {
    nextRateLimitCleanupAt = now + windowMs;
    for (const [key, entry] of rateLimitState.entries()) {
      if (entry.resetAt <= now) rateLimitState.delete(key);
    }
  }

  const ip = getClientIp(c.req.raw);
  const key = `${bucket}:${ip}`;
  const current = rateLimitState.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitState.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  current.count += 1;
  if (current.count <= limit) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  c.header('Retry-After', String(retryAfterSeconds));
  return jsonError(c, 429, 'rate_limited', 'Too many requests. Please retry shortly.');
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPreview(bodyText: string, bodyHtml: string, maxLength = 140): string {
  const source = (bodyText || '').trim() || stripHtml(bodyHtml || '');
  if (!source) return 'No preview available';
  return source.length > maxLength ? `${source.slice(0, maxLength).trimEnd()}...` : source;
}

export function getRetentionDays(env: Env): number {
  const raw = Number(env.RETENTION_DAYS || '');
  if (Number.isFinite(raw) && raw >= 1 && raw <= 90) return Math.floor(raw);
  return 7;
}

export function buildEmailCursor(email?: { timestamp?: string | null; id?: string | null } | null): string {
  const timestamp = email?.timestamp || '';
  const id = email?.id || '';
  return timestamp && id ? `${timestamp}:${id}` : '';
}

export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function encodeBase64Url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeBase64UrlValue(value: string | Uint8Array | ArrayBuffer): string {
  if (typeof value === 'string') return value;
  return encodeBase64Url(decodeBase64Url(value));
}

export function decodeBase64Url(value: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.split('=');
    const name = rawName.trim();
    if (!name) continue;
    cookies.set(name, rest.join('=').trim());
  }

  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
    expires?: Date;
  } = {}
) {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path || '/'}`);
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

async function getOwner(env: Env) {
  return env.DB.prepare('SELECT id, mailbox FROM auth_users WHERE mailbox = ? LIMIT 1')
    .bind(OWNER_AUTH_MAILBOX)
    .first<AuthUserRow>();
}

async function ensureOwner(env: Env) {
  const existing = await getOwner(env);
  if (existing) return existing;

  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO auth_users (id, mailbox) VALUES (?, ?)').bind(id, OWNER_AUTH_MAILBOX).run();
  return { id, mailbox: OWNER_AUTH_MAILBOX } satisfies AuthUserRow;
}

async function listCredentialsByUser(env: Env, userId: string) {
  const result = await env.DB.prepare(
    'SELECT id, credential_id, public_key, counter, user_id, transports FROM auth_credentials WHERE user_id = ? ORDER BY created_at ASC'
  )
    .bind(userId)
    .all<AuthCredentialRow>();

  return result.results || [];
}

async function findCredentialByCredentialId(env: Env, credentialId: string) {
  return env.DB.prepare(
    'SELECT id, credential_id, public_key, counter, user_id, transports FROM auth_credentials WHERE credential_id = ?'
  )
    .bind(credentialId)
    .first<AuthCredentialRow>();
}

async function storeChallenge(
  env: Env,
  userId: string,
  mailbox: string | null,
  flow: 'registration' | 'authentication',
  challenge: string
) {
  await env.DB.prepare("DELETE FROM auth_challenges WHERE user_id = ? AND flow = ?").bind(userId, flow).run();
  await env.DB.prepare(
    "INSERT INTO auth_challenges (id, user_id, mailbox, flow, challenge, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))"
  )
    .bind(crypto.randomUUID(), userId, mailbox, flow, challenge)
    .run();
}

async function getChallenge(env: Env, userId: string, flow: 'registration' | 'authentication') {
  return env.DB.prepare(
    "SELECT id, user_id, flow, challenge FROM auth_challenges WHERE user_id = ? AND flow = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
  )
    .bind(userId, flow)
    .first<AuthChallengeRow>();
}

async function deleteChallenge(env: Env, challengeId: string) {
  await env.DB.prepare('DELETE FROM auth_challenges WHERE id = ?').bind(challengeId).run();
}

async function setSessionCookie(c: Context<Bindings>, userId: string, mailbox: string | null) {
  const token = randomBase64Url(32);
  const tokenHash = await sha256Hex(token);
  const ttlHours = getSessionTtlHours(c.env);
  const maxAge = ttlHours * 60 * 60;

  await c.env.DB.prepare(
    "INSERT INTO auth_sessions (id, user_id, mailbox, token_hash, expires_at, last_used_at) VALUES (?, ?, ?, ?, datetime('now', ?), CURRENT_TIMESTAMP)"
  )
    .bind(crypto.randomUUID(), userId, mailbox, tokenHash, `+${ttlHours} hours`)
    .run();

  c.header(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token, {
      maxAge,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    })
  );
}

function clearSessionCookie(c: Context<Bindings>) {
  c.header(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, '', {
      maxAge: 0,
      expires: new Date(0),
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    })
  );
}

async function getGlobalSession(c: Context<Bindings>) {
  const cookies = parseCookieHeader(c.req.header('cookie') || null);
  const token = cookies.get(SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const session = await c.env.DB.prepare(
    "SELECT id, user_id, expires_at FROM auth_sessions WHERE token_hash = ? AND expires_at > datetime('now')"
  )
    .bind(tokenHash)
    .first<AuthSessionRow>();

  if (!session) return null;

  await c.env.DB.prepare('UPDATE auth_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').bind(session.id).run();
  return session;
}

async function getGlobalAuthStatus(c: Context<Bindings>): Promise<AuthStatus> {
  const enabled = isPasskeyEnabled(c.env);
  if (!enabled) return { enabled: false, hasOwner: false, authenticated: true };

  const owner = await getOwner(c.env);
  const credentials = owner ? await listCredentialsByUser(c.env, owner.id) : [];
  const hasOwner = credentials.length > 0;
  const session = await getGlobalSession(c);

  return {
    enabled: true,
    hasOwner,
    authenticated: Boolean(session),
  };
}

async function requireGlobalAuth(c: Context<Bindings>) {
  if (!isPasskeyEnabled(c.env)) return null;

  const session = await getGlobalSession(c);
  if (session) return null;

  clearSessionCookie(c);
  return jsonError(c, 401, 'auth_required', 'Owner authentication is required to access this application.');
}

export async function cleanupExpiredAuthArtifacts(env: Env) {
  await env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
  await env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
}

export async function cleanupExpiredEmails(env: Env) {
  try {
    const result = await env.DB.prepare("DELETE FROM emails WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
    console.log('cleanup.completed', { deleted: result.meta.changes, retentionDays: getRetentionDays(env) });
  } catch (error) {
    console.error('cleanup.failed', { error });
    throw error;
  }
}

function readTransportList(value: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as AuthenticatorTransportFuture[]) : undefined;
  } catch (error) {
    console.error('auth.passkey.invalid_transports', { error, value });
    return undefined;
  }
}

app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  const bucket: keyof typeof RATE_LIMITS =
    path === '/api/mailbox/random'
      ? 'random'
      : path.startsWith('/api/auth/')
        ? 'auth'
        : path === '/api/stream'
          ? 'stream'
          : path.startsWith('/api/email/')
            ? 'emailDetail'
            : 'inboxList';

  const limited = applyRateLimit(c, bucket);
  if (limited) return limited;

  // Global Auth Guard for API
  if (isPasskeyEnabled(c.env) && !path.startsWith('/api/auth/')) {
    const unauthorized = await requireGlobalAuth(c);
    if (unauthorized) return unauthorized;
  }

  await next();
});

app.onError((error, c) => {
  console.error('request.failed', { path: c.req.path, error });

  if (c.req.path.startsWith('/api/')) {
    return jsonError(c, 500, 'internal_error', 'Internal server error.');
  }

  return c.text('Internal Server Error', 500);
});

app.get('/api/mailbox/random', (c) => {
  const mailDomains = getMailDomains(c.env);
  const requestedDomain = String(c.req.query('domain') || '').trim().toLowerCase();
  const selectedDomain = mailDomains.includes(requestedDomain)
    ? requestedDomain
    : getPrimaryMailDomain(c.env);

  return c.json({ mailbox: randomMailbox(selectedDomain), domains: mailDomains, domain: selectedDomain });
});

app.get('/api/auth/status', async (c) => {
  const status = await getGlobalAuthStatus(c);
  return c.json(status);
});

app.post('/api/auth/register/options', async (c) => {
  if (!isPasskeyEnabled(c.env)) {
    return jsonError(c, 404, 'passkey_disabled', 'Passkey authentication is disabled.');
  }

  const owner = await ensureOwner(c.env);
  const existingCredentials = await listCredentialsByUser(c.env, owner.id);
  if (existingCredentials.length > 0) {
    return jsonError(c, 409, 'already_registered', 'An owner passkey is already registered.');
  }

  const rpID = getPasskeyRpID(c.env, c.req.url);
  const options = await generateRegistrationOptions({
    rpID,
    rpName: getPasskeyRpName(c.env),
    userID: textEncoder.encode(owner.id),
    userName: 'Owner',
    userDisplayName: 'App Owner',
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
  });

  await storeChallenge(c.env, owner.id, owner.mailbox, 'registration', options.challenge);
  return c.json({ options });
});

app.post('/api/auth/register/verify', async (c) => {
  if (!isPasskeyEnabled(c.env)) {
    return jsonError(c, 404, 'passkey_disabled', 'Passkey authentication is disabled.');
  }

  const payload = (await c.req.json().catch(() => null)) as {
    response?: unknown;
  } | null;
  if (!payload?.response) {
    return jsonError(c, 400, 'invalid_request', 'WebAuthn response is required.');
  }

  const owner = await getOwner(c.env);
  if (!owner) {
    return jsonError(c, 404, 'not_found', 'Owner context was not found.');
  }

  const challenge = await getChallenge(c.env, owner.id, 'registration');
  if (!challenge) {
    return jsonError(c, 400, 'challenge_missing', 'Registration challenge expired.');
  }

  const verification = await verifyRegistrationResponse({
    response: payload.response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
    expectedChallenge: challenge.challenge,
    expectedOrigin: getPasskeyOrigin(c.req.url),
    expectedRPID: getPasskeyRpID(c.env, c.req.url),
    requireUserVerification: false,
  }).catch((error) => {
    console.error('auth.passkey.register_verify_failed', { error });
    return null;
  });

  if (!verification?.verified || !verification.registrationInfo) {
    return jsonError(c, 400, 'registration_failed', 'Passkey registration could not be verified.');
  }

  const credential = verification.registrationInfo.credential;
  await c.env.DB.prepare(
    'INSERT INTO auth_credentials (id, credential_id, public_key, counter, user_id, transports) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      encodeBase64Url(credential.id),
      encodeBase64Url(credential.publicKey),
      credential.counter,
      owner.id,
      JSON.stringify(credential.transports || [])
    )
    .run();

  await deleteChallenge(c.env, challenge.id);
  await setSessionCookie(c, owner.id, owner.mailbox);
  return c.json({ ok: true, authenticated: true });
});

app.post('/api/auth/login/options', async (c) => {
  if (!isPasskeyEnabled(c.env)) {
    return jsonError(c, 404, 'passkey_disabled', 'Passkey authentication is disabled.');
  }

  const owner = await getOwner(c.env);
  if (!owner) {
    return jsonError(c, 404, 'not_found', 'No owner passkey is registered yet.');
  }

  const credentials = await listCredentialsByUser(c.env, owner.id);
  if (credentials.length === 0) {
    return jsonError(c, 404, 'not_found', 'No owner passkey is registered yet.');
  }

  const options = await generateAuthenticationOptions({
    rpID: getPasskeyRpID(c.env, c.req.url),
    userVerification: 'preferred',
    allowCredentials: credentials.map((credential) => ({
      id: normalizeBase64UrlValue(credential.credential_id),
      type: 'public-key',
      transports: readTransportList(credential.transports),
    })),
  });

  await storeChallenge(c.env, owner.id, owner.mailbox, 'authentication', options.challenge);
  return c.json({ options });
});

app.post('/api/auth/login/verify', async (c) => {
  if (!isPasskeyEnabled(c.env)) {
    return jsonError(c, 404, 'passkey_disabled', 'Passkey authentication is disabled.');
  }

  const payload = (await c.req.json().catch(() => null)) as {
    response?: { id?: string } & Record<string, unknown>;
  } | null;
  if (!payload?.response?.id) {
    return jsonError(c, 400, 'invalid_request', 'WebAuthn response is required.');
  }

  const owner = await getOwner(c.env);
  if (!owner) {
    return jsonError(c, 404, 'not_found', 'No owner passkey is registered yet.');
  }

  const challenge = await getChallenge(c.env, owner.id, 'authentication');
  if (!challenge) {
    return jsonError(c, 400, 'challenge_missing', 'Authentication challenge expired.');
  }

  const storedCredential =
    (await findCredentialByCredentialId(c.env, payload.response.id)) ||
    (await listCredentialsByUser(c.env, owner.id)).find(
      (credential) => normalizeBase64UrlValue(credential.credential_id) === payload.response.id
    ) ||
    null;
  if (!storedCredential || storedCredential.user_id !== owner.id) {
    return jsonError(c, 404, 'credential_not_found', 'Passkey credential was not found.');
  }

  const verification = await verifyAuthenticationResponse({
    response: payload.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
    expectedChallenge: challenge.challenge,
    expectedOrigin: getPasskeyOrigin(c.req.url),
    expectedRPID: getPasskeyRpID(c.env, c.req.url),
    requireUserVerification: false,
    credential: {
      id: normalizeBase64UrlValue(storedCredential.credential_id),
      publicKey: decodeBase64Url(normalizeBase64UrlValue(storedCredential.public_key)),
      counter: storedCredential.counter,
      transports: readTransportList(storedCredential.transports),
    },
  }).catch((error) => {
    console.error('auth.passkey.login_verify_failed', { error });
    return null;
  });

  if (!verification?.verified) {
    return jsonError(c, 400, 'authentication_failed', 'Passkey authentication could not be verified.');
  }

  await c.env.DB.prepare('UPDATE auth_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(verification.authenticationInfo.newCounter, storedCredential.id)
    .run();
  await deleteChallenge(c.env, challenge.id);
  await setSessionCookie(c, owner.id, owner.mailbox);
  return c.json({ ok: true, authenticated: true });
});

app.post('/api/auth/logout', async (c) => {
  const cookies = parseCookieHeader(c.req.header('cookie') || null);
  const token = cookies.get(SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get('/api/emails', async (c) => {
  const mailDomains = getMailDomains(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomains);
  if (!mailbox) {
    return jsonError(c, 400, 'invalid_mailbox', `Query parameter \`to\` must be a valid mailbox for supported domains.`);
  }

  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, id_from, subject, timestamp, COALESCE(preview, CASE WHEN trim(coalesce(body_text, '')) != '' THEN substr(trim(body_text), 1, 140) ELSE 'No preview available' END) AS preview FROM emails WHERE id_to = ? ORDER BY timestamp DESC, id DESC LIMIT ?"
    )
      .bind(mailbox, 50)
      .all();

    return c.json(results);
  } catch (error) {
    console.error('api.emails.list_failed', { mailbox, error });
    return jsonError(c, 500, 'db_error', 'Failed to load emails.');
  }
});

app.get('/api/email/:id', async (c) => {
  const id = c.req.param('id');
  const mailDomains = getMailDomains(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomains);

  if (!id || !mailbox) {
    return jsonError(c, 400, 'invalid_request', `Email id and query parameter \`to\` are required.`);
  }

  try {
    const email = await c.env.DB.prepare('SELECT * FROM emails WHERE id = ? AND id_to = ?').bind(id, mailbox).first();

    if (!email) return jsonError(c, 404, 'not_found', 'Email not found.');
    return c.json(email);
  } catch (error) {
    console.error('api.email.detail_failed', { mailbox, id, error });
    return jsonError(c, 500, 'db_error', 'Failed to load email.');
  }
});

app.get('/api/stream', async (c) => {
  const mailDomains = getMailDomains(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomains);

  if (!mailbox) {
    return jsonError(c, 400, 'invalid_mailbox', `Missing or invalid \`to\` query parameter.`);
  }

  const abortSignal = c.req.raw.signal;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const closeStream = () => {
        if (closed) return;
        closed = true;
        abortSignal?.removeEventListener('abort', closeStream);
        try {
          controller.close();
        } catch {
          // noop
        }
      };

      const writeEvent = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closeStream();
        }
      };

      abortSignal?.addEventListener('abort', closeStream, { once: true });
      writeEvent('ready', { mailbox });

      let lastSeen = '';

      try {
        while (!closed && !abortSignal?.aborted) {
          const latest = await c.env.DB.prepare(
            'SELECT id, timestamp FROM emails WHERE id_to = ? ORDER BY timestamp DESC, id DESC LIMIT 1'
          )
            .bind(mailbox)
            .first<{ id: string; timestamp: string }>();

          const latestCursor = buildEmailCursor(latest);
          if (latestCursor && latestCursor !== lastSeen) {
            lastSeen = latestCursor;
            writeEvent('update', { id: latest?.id, at: latest?.timestamp });
          } else {
            writeEvent('ping', { t: Date.now() });
          }

          if (!(await sleep(3000, abortSignal))) break;
        }
      } catch (error) {
        if (!closed && !abortSignal?.aborted) {
          console.error('api.stream.failed', { mailbox, error });
        }
      } finally {
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

app.get('/', (c) => {
  const mailDomains = getMailDomains(c.env);
  const primaryDomain = getPrimaryMailDomain(c.env);
  return c.html(renderHomePage(primaryDomain, mailDomains, { passkeyEnabled: isPasskeyEnabled(c.env) }));
});

export function resetRateLimitState(now = 0) {
  rateLimitState.clear();
  nextRateLimitCleanupAt = now;
}

export function getRateLimitStateSnapshot() {
  return {
    nextRateLimitCleanupAt,
    entries: Array.from(rateLimitState.entries()).map(([key, entry]) => ({
      key,
      count: entry.count,
      resetAt: entry.resetAt,
    })),
  };
}

export { RATE_LIMITS, app };

const worker = {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env) {
    await cleanupExpiredEmails(env);
    await cleanupExpiredAuthArtifacts(env);
  },
  async email(message: ForwardableEmailMessage, env: Env) {
    const mailDomains = getMailDomains(env);
    const normalizedTo = normalizeMailbox(message.to || '', mailDomains);
    if (!normalizedTo) {
      console.warn('email.rejected.invalid_recipient', { to: message.to });
      return;
    }

    const parser = new PostalMime();
    let parsedEmail: Awaited<ReturnType<PostalMime['parse']>>;

    try {
      const rawEmail = await new Response(message.raw).arrayBuffer();
      parsedEmail = await parser.parse(rawEmail);
      console.log('email.parsed', { to: normalizedTo, from: message.from, subject: parsedEmail.subject || '(No Subject)' });
    } catch (error) {
      console.error('email.parse_failed', { to: normalizedTo, error });
      return;
    }

    const bodyText = parsedEmail.text || '';
    const bodyHtml = typeof parsedEmail.html === 'string' ? parsedEmail.html : '';
    const preview = buildPreview(bodyText, bodyHtml);

    try {
      await env.DB.prepare(
        "INSERT INTO emails (id, id_to, id_from, subject, body_text, body_html, preview, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))"
      )
        .bind(
          crypto.randomUUID(),
          normalizedTo,
          message.from,
          parsedEmail.subject || '(No Subject)',
          bodyText,
          bodyHtml,
          preview,
          `+${getRetentionDays(env)} days`
        )
        .run();
      console.log('email.stored', { to: normalizedTo, from: message.from });
    } catch (error) {
      console.error('email.store_failed', { to: normalizedTo, error });
    }
  },
};

export default worker;
