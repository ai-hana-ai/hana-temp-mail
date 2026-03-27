import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker, {
  RATE_LIMITS,
  app,
  applyRateLimit,
  buildEmailCursor,
  buildPreview,
  cleanupExpiredEmails,
  decodeBase64Url,
  decodeHtmlEntities,
  getClientIp,
  getMailDomains,
  getPrimaryMailDomain,
  getRateLimitStateSnapshot,
  getRateLimitWindowMs,
  getRetentionDays,
  jsonError,
  normalizeMailbox,
  randomLocalPart,
  randomMailbox,
  resetRateLimitState,
  sleep,
  stripHtml,
} from '../index';
import { renderHomePage } from '../ui.tsx';

type EmailRow = {
  id: string;
  id_to: string;
  id_from: string;
  subject: string;
  body_text: string;
  body_html: string;
  preview: string | null;
  expires_at: string | null;
  timestamp: string;
};

type FakeEnv = {
  DB: FakeD1Database;
  MAIL_DOMAIN?: string;
  MAIL_DOMAINS?: string;
  RETENTION_DAYS?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  ENABLE_PASSKEY?: string;
  SESSION_TTL_HOURS?: string;
};

type AuthUser = {
  id: string;
  mailbox: string;
};

type AuthCredential = {
  id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  user_id: string;
  transports: string | null;
  created_at: string;
  last_used_at: string | null;
};

type AuthChallenge = {
  id: string;
  user_id: string;
  mailbox: string;
  flow: 'registration' | 'authentication';
  challenge: string;
  expires_at: string;
  created_at: string;
};

type AuthSession = {
  id: string;
  user_id: string;
  mailbox: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
};

function toSqliteTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '');
}

function parseSqliteTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
}

class FakeStatement {
  private args: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async all() {
    if (this.sql.includes('FROM auth_credentials WHERE user_id = ?')) {
      const [userId] = this.args as [string];
      const results = this.db.authCredentials
        .filter((credential) => credential.user_id === userId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { results };
    }

    if (this.db.failList) throw new Error('list failed');

    const [mailbox, limit] = this.args as [string, number];
    const results = this.db.emails
      .filter((email) => email.id_to === mailbox)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((email) => ({
        id: email.id,
        id_from: email.id_from,
        subject: email.subject,
        timestamp: email.timestamp,
        preview:
          email.preview ??
          ((email.body_text || '').trim() ? (email.body_text || '').trim().slice(0, 140) : 'No preview available'),
      }));

    return { results };
  }

  async first<T>() {
    if (this.sql.includes('SELECT id, mailbox FROM auth_users')) {
      const [mailbox] = this.args as [string];
      return (this.db.authUsers.find((user) => user.mailbox === mailbox) ?? null) as T | null;
    }

    if (this.sql.includes('SELECT id, user_id, flow, challenge FROM auth_challenges')) {
      const [userId, flow] = this.args as [string, AuthChallenge['flow']];
      const now = this.db.sqliteNow();
      const challenge =
        this.db.authChallenges
          .filter((entry) => entry.user_id === userId && entry.flow === flow && entry.expires_at > now)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
      return challenge as T | null;
    }

    if (this.sql.includes('SELECT id, credential_id, public_key, counter, user_id, transports FROM auth_credentials WHERE credential_id = ?')) {
      const [credentialId] = this.args as [string];
      return (this.db.authCredentials.find((credential) => credential.credential_id === credentialId) ?? null) as T | null;
    }

    if (this.sql.includes('SELECT id, user_id, expires_at FROM auth_sessions')) {
      const [tokenHash] = this.args as [string];
      const now = this.db.sqliteNow();
      const session = this.db.authSessions.find((entry) => entry.token_hash === tokenHash && entry.expires_at > now) ?? null;
      return session as T | null;
    }

    if (this.sql.includes('SELECT * FROM emails')) {
      if (this.db.failDetail) throw new Error('detail failed');
      const [id, mailbox] = this.args as [string, string];
      return (this.db.emails.find((email) => email.id === id && email.id_to === mailbox) ?? null) as T | null;
    }

    if (this.sql.includes('SELECT id, timestamp FROM emails')) {
      if (this.db.failLatest) throw new Error('latest failed');
      const [mailbox] = this.args as [string];
      const email =
        this.db.emails
          .filter((entry) => entry.id_to === mailbox)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))[0] ?? null;

      return (email ? { id: email.id, timestamp: email.timestamp } : null) as T | null;
    }

    return null as T | null;
  }

  async run() {
    if (this.sql.startsWith('INSERT INTO auth_users')) {
      const [id, mailbox] = this.args as [string, string];
      this.db.authUsers.push({ id, mailbox });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith('DELETE FROM auth_challenges WHERE user_id = ? AND flow = ?')) {
      const [userId, flow] = this.args as [string, AuthChallenge['flow']];
      const before = this.db.authChallenges.length;
      this.db.authChallenges = this.db.authChallenges.filter((entry) => !(entry.user_id === userId && entry.flow === flow));
      return { meta: { changes: before - this.db.authChallenges.length } };
    }

    if (this.sql.startsWith('INSERT INTO auth_challenges')) {
      const [id, userId, mailbox, flow, challenge] = this.args as [
        string,
        string,
        string,
        AuthChallenge['flow'],
        string,
      ];
      const createdAt = toSqliteTimestamp(new Date(this.db.now()));
      const expiresAt = toSqliteTimestamp(new Date(this.db.now() + 10 * 60 * 1000));
      this.db.authChallenges.push({ id, user_id: userId, mailbox, flow, challenge, created_at: createdAt, expires_at: expiresAt });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith('DELETE FROM auth_challenges WHERE id = ?')) {
      const [id] = this.args as [string];
      const before = this.db.authChallenges.length;
      this.db.authChallenges = this.db.authChallenges.filter((entry) => entry.id !== id);
      return { meta: { changes: before - this.db.authChallenges.length } };
    }

    if (this.sql.startsWith('INSERT INTO auth_sessions')) {
      const [id, userId, mailbox, tokenHash, ttlHoursRaw] = this.args as [string, string, string, string, string];
      const ttlHours = Number(String(ttlHoursRaw).replace(/[^\d]/g, '')) || 0;
      const createdAt = toSqliteTimestamp(new Date(this.db.now()));
      const expiresAt = toSqliteTimestamp(new Date(this.db.now() + ttlHours * 60 * 60 * 1000));
      this.db.authSessions.push({
        id,
        user_id: userId,
        mailbox,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: createdAt,
        last_used_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith('UPDATE auth_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')) {
      const [id] = this.args as [string];
      const session = this.db.authSessions.find((entry) => entry.id === id);
      if (session) session.last_used_at = toSqliteTimestamp(new Date(this.db.now()));
      return { meta: { changes: session ? 1 : 0 } };
    }

    if (this.sql.startsWith('DELETE FROM auth_sessions WHERE token_hash = ?')) {
      const [tokenHash] = this.args as [string];
      const before = this.db.authSessions.length;
      this.db.authSessions = this.db.authSessions.filter((entry) => entry.token_hash !== tokenHash);
      return { meta: { changes: before - this.db.authSessions.length } };
    }

    if (this.sql.startsWith('DELETE FROM auth_challenges WHERE expires_at IS NOT NULL')) {
      const before = this.db.authChallenges.length;
      const now = this.db.sqliteNow();
      this.db.authChallenges = this.db.authChallenges.filter((entry) => !(entry.expires_at <= now));
      return { meta: { changes: before - this.db.authChallenges.length } };
    }

    if (this.sql.startsWith('DELETE FROM auth_sessions WHERE expires_at IS NOT NULL')) {
      const before = this.db.authSessions.length;
      const now = this.db.sqliteNow();
      this.db.authSessions = this.db.authSessions.filter((entry) => !(entry.expires_at <= now));
      return { meta: { changes: before - this.db.authSessions.length } };
    }

    if (this.sql.startsWith('DELETE FROM emails')) {
      if (this.db.failCleanup) throw new Error('cleanup failed');
      const now = this.db.now();
      const before = this.db.emails.length;
      this.db.emails = this.db.emails.filter((email) => {
        if (!email.expires_at) return true;
        return parseSqliteTimestamp(email.expires_at) > now;
      });
      return { meta: { changes: before - this.db.emails.length } };
    }

    if (this.sql.startsWith('INSERT INTO emails')) {
      if (this.db.failInsert) throw new Error('insert failed');
      const [id, idTo, idFrom, subject, bodyText, bodyHtml, preview, retentionModifier] = this.args as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];

      const days = Number(String(retentionModifier).replace(/[^\d]/g, '')) || 0;
      const now = new Date(this.db.now());
      const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      this.db.emails.push({
        id,
        id_to: idTo,
        id_from: idFrom,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        preview,
        expires_at: toSqliteTimestamp(expiresAt),
        timestamp: toSqliteTimestamp(now),
      });
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unsupported SQL in fake D1: ${this.sql}`);
  }
}

class FakeD1Database {
  emails: EmailRow[] = [];
  authUsers: AuthUser[] = [];
  authCredentials: AuthCredential[] = [];
  authChallenges: AuthChallenge[] = [];
  authSessions: AuthSession[] = [];
  failList = false;
  failDetail = false;
  failLatest = false;
  failCleanup = false;
  failInsert = false;

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  now() {
    return Date.now();
  }

  sqliteNow() {
    return toSqliteTimestamp(new Date(this.now()));
  }
}

function makeEnv(overrides: Partial<FakeEnv> = {}): FakeEnv {
  return {
    DB: overrides.DB ?? new FakeD1Database(),
    MAIL_DOMAIN: overrides.MAIL_DOMAIN ?? 'adopsee.com',
    MAIL_DOMAINS: overrides.MAIL_DOMAINS,
    RETENTION_DAYS: overrides.RETENTION_DAYS,
    RATE_LIMIT_WINDOW_MS: overrides.RATE_LIMIT_WINDOW_MS,
    ENABLE_PASSKEY: overrides.ENABLE_PASSKEY,
    SESSION_TTL_HOURS: overrides.SESSION_TTL_HOURS,
  };
}

async function request(path: string, env: FakeEnv, init?: RequestInit) {
  return worker.fetch(new Request(`https://temp-mail.test${path}`, init), env as never);
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value, done } = await reader.read();
  if (done) return null;
  return new TextDecoder().decode(value);
}

describe('worker helpers', () => {
  beforeEach(() => {
    resetRateLimitState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the homepage with the configured domain', () => {
    const html = renderHomePage('mail.example');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('@mail.example');
    expect(html).toContain('<script type="module">');
    expect(html).toContain("import { reactive } from 'https://esm.sh/@arrow-js/core';");
    expect(html).toContain('mailboxLocalPartRegexSource');
    expect(html).toContain('data-cloak="true"');
    expect(html).toContain('Temporary Mail');
    expect(html).toContain('mailDomains');
    expect(html).not.toContain('/app.js');
  });

  it('covers pure helper branches', async () => {
    expect(getMailDomains(makeEnv())).toEqual(['adopsee.com']);
    expect(getMailDomains(makeEnv({ MAIL_DOMAIN: ' Mail.Example ' }))).toEqual(['mail.example']);

    expect(normalizeMailbox(' Hana ', ['adopsee.com'])).toBe('hana@adopsee.com');
    expect(normalizeMailbox(' Hana@Pringgo.Dev ', ['adopsee.com', 'pringgo.dev'])).toBe('hana@pringgo.dev');
    expect(normalizeMailbox(null, ['adopsee.com'])).toBeNull();

    expect(getRateLimitWindowMs(makeEnv())).toBe(60_000);
    expect(getRateLimitWindowMs(makeEnv({ RATE_LIMIT_WINDOW_MS: '5000' }))).toBe(5000);
    expect(getRateLimitWindowMs(makeEnv({ RATE_LIMIT_WINDOW_MS: '100' }))).toBe(60_000);

    expect(getRetentionDays(makeEnv())).toBe(7);
    expect(getRetentionDays(makeEnv({ RETENTION_DAYS: '14' }))).toBe(14);
    expect(getRetentionDays(makeEnv({ RETENTION_DAYS: '0' }))).toBe(7);
    expect(getRetentionDays(makeEnv({ RETENTION_DAYS: '99' }))).toBe(7);

    expect(getClientIp(new Request('https://example.test', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }))).toBe('1.1.1.1');
    expect(getClientIp(new Request('https://example.test', { headers: { 'x-forwarded-for': '2.2.2.2, 3.3.3.3' } }))).toBe('2.2.2.2');
    expect(getClientIp(new Request('https://example.test'))).toBe('unknown');

    expect(randomLocalPart(24)).toMatch(/^[a-z0-9]{24}$/);
    expect(randomMailbox('adopsee.com')).toMatch(/^[a-z0-9]{10}@adopsee\.com$/);

    expect(decodeHtmlEntities('&nbsp;&amp;&lt;&gt;&quot;&#39;')).toBe(` &<>"'`);
    expect(stripHtml('<style>a{}</style><script>alert(1)</script><!--x--><b>Hello&nbsp;World</b>')).toBe('Hello World');

    expect(buildPreview('Plain body', '<p>ignored</p>')).toBe('Plain body');
    expect(buildPreview('', '<p>Hello &amp; welcome</p>')).toBe('Hello & welcome');
    expect(buildPreview('', '')).toBe('No preview available');
    expect(buildPreview('x'.repeat(150), '', 10)).toBe('xxxxxxxxxx...');

    expect(buildEmailCursor({ id: '123', timestamp: '2026-03-25 10:00:00' })).toBe('2026-03-25 10:00:00:123');
    expect(buildEmailCursor({ id: null, timestamp: '2026-03-25 10:00:00' })).toBe('');
    expect(buildEmailCursor()).toBe('');

    const bytes = new Uint8Array([99, 114, 101, 100, 45, 105, 100]);
    expect(decodeBase64Url(bytes)).toBe(bytes);
    expect(Array.from(decodeBase64Url(bytes.buffer))).toEqual(Array.from(bytes));
    expect(new TextDecoder().decode(decodeBase64Url('Y3JlZC1pZA'))).toBe('cred-id');

    expect(await sleep(0)).toBe(true);

    const aborted = new AbortController();
    aborted.abort();
    expect(await sleep(5, aborted.signal)).toBe(false);

    vi.useFakeTimers();
    const controller = new AbortController();
    const sleeping = sleep(100, controller.signal);
    controller.abort();
    await expect(sleeping).resolves.toBe(false);
  });

  it('creates json errors and applies rate limiting directly', async () => {
    const env = makeEnv({ RATE_LIMIT_WINDOW_MS: '1000' });
    const response = await app.request('/api/mailbox/random', {}, env as never);
    expect(response.status).toBe(200);

    const context = app.request.bind(app);
    expect(context).toBeTypeOf('function');

    const limitedEnv = makeEnv({ RATE_LIMIT_WINDOW_MS: '1000' });
    const limitedRequest = new Request('https://temp-mail.test/api/emails?to=hana@adopsee.com', {
      headers: { 'CF-Connecting-IP': '9.9.9.9' },
    });
    const limitedResponse = await app.fetch(limitedRequest, limitedEnv as never);
    expect(limitedResponse.status).toBe(200);

    const errorResponse = jsonError(
      {
        json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
      } as never,
      418,
      'teapot',
      'Short and stout'
    );
    expect(errorResponse.status).toBe(418);
    await expect(errorResponse.json()).resolves.toEqual({ error: 'Short and stout', code: 'teapot' });

    const rateEnv = makeEnv({ RATE_LIMIT_WINDOW_MS: '1000' });
    const fakeContext = {
      env: rateEnv,
      req: { raw: new Request('https://temp-mail.test', { headers: { 'CF-Connecting-IP': '8.8.8.8' } }) },
      header: vi.fn(),
      json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
    } as never;

    for (let i = 0; i < RATE_LIMITS.random; i += 1) {
      expect(applyRateLimit(fakeContext, 'random')).toBeNull();
    }

    const blocked = applyRateLimit(fakeContext, 'random');
    expect(blocked?.status).toBe(429);
    expect(fakeContext.header).toHaveBeenCalledWith('Retry-After', '1');
    await expect(blocked?.json()).resolves.toEqual({
      error: 'Too many requests. Please retry shortly.',
      code: 'rate_limited',
    });
  });
});

describe('HTTP routes', () => {
  beforeEach(() => {
    resetRateLimitState();
    vi.restoreAllMocks();
  });

  it('serves the homepage route', async () => {
    const response = await request('/', makeEnv({ MAIL_DOMAIN: 'box.test' }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('@box.test');
  });

  it('returns a random mailbox response', async () => {
    const response = await request('/api/mailbox/random', makeEnv({ MAIL_DOMAIN: 'box.test' }));
    const data = await response.json<{ mailbox: string; domain: string }>();

    expect(response.status).toBe(200);
    expect(data.domains).toContain('box.test');
    expect(data.mailbox).toMatch(/^[a-z0-9]{10}@box\.test$/);
  });

  it('returns a random mailbox for the requested allowed domain', async () => {
    const response = await request(
      '/api/mailbox/random?domain=pringgo.dev',
      makeEnv({ MAIL_DOMAINS: 'adopsee.com, pringgo.dev' })
    );
    const data = await response.json<{ mailbox: string; domain: string; domains: string[] }>();

    expect(response.status).toBe(200);
    expect(data.domain).toBe('pringgo.dev');
    expect(data.domains).toEqual(['adopsee.com', 'pringgo.dev']);
    expect(data.mailbox).toMatch(/^[a-z0-9]{10}@pringgo\.dev$/);
  });

  it('lists inbox emails and validates mailbox input', async () => {
    const db = new FakeD1Database();
    db.emails.push(
      {
        id: 'b',
        id_to: 'hana@adopsee.com',
        id_from: 'beta@example.com',
        subject: 'Second',
        body_text: '',
        body_html: '',
        preview: null,
        expires_at: null,
        timestamp: '2026-03-25 11:00:00',
      },
      {
        id: 'a',
        id_to: 'hana@adopsee.com',
        id_from: 'alpha@example.com',
        subject: 'First',
        body_text: 'plain preview text',
        body_html: '',
        preview: 'trimmed preview',
        expires_at: null,
        timestamp: '2026-03-25 10:00:00',
      }
    );

    const env = makeEnv({ DB: db });
    const okResponse = await request('/api/emails?to=Hana', env);
    const emails = await okResponse.json<Array<{ id: string; preview: string }>>();

    expect(okResponse.status).toBe(200);
    expect(emails.map((email) => email.id)).toEqual(['b', 'a']);
    expect(emails[0]?.preview).toBe('No preview available');
    expect(emails[1]?.preview).toBe('trimmed preview');

    const badResponse = await request('/api/emails?to=bad@wrong.test', env);
    expect(badResponse.status).toBe(400);
    await expect(badResponse.json()).resolves.toMatchObject({ code: 'invalid_mailbox' });

    const missingResponse = await request('/api/emails', env);
    expect(missingResponse.status).toBe(400);
    await expect(missingResponse.json()).resolves.toMatchObject({ code: 'invalid_mailbox' });

    db.failList = true;
    const failedResponse = await request('/api/emails?to=hana', env);
    expect(failedResponse.status).toBe(500);
    await expect(failedResponse.json()).resolves.toMatchObject({ code: 'db_error' });
  });

  it('returns email details and handles invalid and missing records', async () => {
    const db = new FakeD1Database();
    db.emails.push({
      id: 'email-1',
      id_to: 'hana@adopsee.com',
      id_from: 'sender@example.com',
      subject: 'Hello',
      body_text: 'text',
      body_html: '<p>html</p>',
      preview: 'text',
      expires_at: null,
      timestamp: '2026-03-25 10:00:00',
    });

    const env = makeEnv({ DB: db });
    const invalid = await request('/api/email/email-1', env);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'invalid_request' });

    const ok = await request('/api/email/email-1?to=hana', env);
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ id: 'email-1', id_to: 'hana@adopsee.com' });

    const missing = await request('/api/email/missing?to=hana', env);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' });

    db.failDetail = true;
    const failed = await request('/api/email/email-1?to=hana', env);
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({ code: 'db_error' });
  });

  it('enforces route rate limits and cleans expired limiter entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T10:00:00Z'));

    const env = makeEnv({ RATE_LIMIT_WINDOW_MS: '1000' });
    for (let i = 0; i < RATE_LIMITS.random; i += 1) {
      const response = await request('/api/mailbox/random', env, {
        headers: { 'CF-Connecting-IP': '4.4.4.4' },
      });
      expect(response.status).toBe(200);
    }

    const blocked = await request('/api/mailbox/random', env, {
      headers: { 'CF-Connecting-IP': '4.4.4.4' },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('1');

    vi.setSystemTime(new Date('2026-03-25T10:00:02Z'));
    const afterWindow = await request('/api/mailbox/random', env, {
      headers: { 'CF-Connecting-IP': '5.5.5.5' },
    });
    expect(afterWindow.status).toBe(200);

    const snapshot = getRateLimitStateSnapshot();
    expect(snapshot.entries).toEqual([
      expect.objectContaining({ key: 'random:5.5.5.5', count: 1 }),
    ]);
  });

  it('returns JSON for passkey auth setup and auth middleware failures', async () => {
    const env = makeEnv({ ENABLE_PASSKEY: 'true', SESSION_TTL_HOURS: '12' });

    const optionsResponse = await request('/api/auth/register/options', env, { method: 'POST' });
    expect(optionsResponse.status).toBe(200);
    await expect(optionsResponse.json()).resolves.toMatchObject({
      options: expect.objectContaining({
        rp: expect.objectContaining({ name: 'Hana Temp Mail', id: 'temp-mail.test' }),
        user: expect.objectContaining({ name: 'Owner', displayName: 'App Owner' }),
      }),
    });
    expect(env.DB.authUsers).toEqual([{ id: expect.any(String), mailbox: '__hana_owner__' }]);
    expect(env.DB.authChallenges).toEqual([
      expect.objectContaining({
        mailbox: '__hana_owner__',
        flow: 'registration',
        challenge: expect.any(String),
      }),
    ]);

    const gatedResponse = await request('/api/emails?to=hana', env);
    expect(gatedResponse.status).toBe(401);
    await expect(gatedResponse.json()).resolves.toMatchObject({ code: 'auth_required' });

    env.DB.authCredentials.push({
      id: 'cred-1',
      credential_id: 'Y3JlZC1pZA',
      public_key: 'not-base64url',
      counter: 0,
      user_id: env.DB.authUsers[0]!.id,
      transports: 'not-json',
      created_at: env.DB.sqliteNow(),
      last_used_at: null,
    });

    const loginOptionsResponse = await request('/api/auth/login/options', env, { method: 'POST' });
    expect(loginOptionsResponse.status).toBe(200);
    await expect(loginOptionsResponse.json()).resolves.toMatchObject({
      options: expect.objectContaining({
        challenge: expect.any(String),
        rpId: 'temp-mail.test',
        allowCredentials: [
          expect.objectContaining({
            type: 'public-key',
            id: 'Y3JlZC1pZA',
          }),
        ],
      }),
    });
  });
});

describe('SSE flow', () => {
  beforeEach(() => {
    resetRateLimitState();
    vi.restoreAllMocks();
  });

  it('streams ready, update, and ping events and handles disconnect', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T10:00:00Z'));

    const db = new FakeD1Database();
    db.emails.push({
      id: 'first',
      id_to: 'hana@adopsee.com',
      id_from: 'sender@example.com',
      subject: 'Hello',
      body_text: 'body',
      body_html: '',
      preview: 'body',
      expires_at: null,
      timestamp: '2026-03-25 10:00:00',
    });

    const env = makeEnv({ DB: db });
    const abortController = new AbortController();
    const response = await request('/api/stream?to=hana', env, { signal: abortController.signal });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');

    const reader = response.body!.getReader();
    const readyChunk = await readEvent(reader);
    expect(readyChunk).toContain('event: ready');

    const initialUpdateChunk = await readEvent(reader);
    expect(initialUpdateChunk).toContain('event: update');
    expect(initialUpdateChunk).toContain('"id":"first"');

    const pendingChunk = readEvent(reader);
    vi.setSystemTime(new Date('2026-03-25T10:00:03Z'));
    await vi.advanceTimersByTimeAsync(3000);
    const secondChunk = await pendingChunk;
    expect(secondChunk).toContain('event: ping');

    db.emails.push({
      id: 'second',
      id_to: 'hana@adopsee.com',
      id_from: 'next@example.com',
      subject: 'Next',
      body_text: 'body',
      body_html: '',
      preview: 'body',
      expires_at: null,
      timestamp: '2026-03-25 10:00:04',
    });

    const updateChunkPromise = readEvent(reader);
    vi.setSystemTime(new Date('2026-03-25T10:00:06Z'));
    await vi.advanceTimersByTimeAsync(3000);
    const updateChunk = await updateChunkPromise;
    expect(updateChunk).toContain('event: update');
    expect(updateChunk).toContain('"id":"second"');

    const closePromise = readEvent(reader);
    abortController.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(closePromise).resolves.toBeNull();
  });

  it('validates mailbox input and suppresses stream errors after disconnect', async () => {
    const env = makeEnv();
    const invalid = await request('/api/stream?to=bad@wrong.test', env);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'invalid_mailbox' });

    const missing = await request('/api/stream', env);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ code: 'invalid_mailbox' });

    vi.useFakeTimers();
    const db = new FakeD1Database();
    db.failLatest = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const aborted = new AbortController();
    aborted.abort();

    const response = await request('/api/stream?to=hana', makeEnv({ DB: db }), { signal: aborted.signal });
    const reader = response.body!.getReader();
    await expect(readEvent(reader)).resolves.toContain('event: ready');
    await expect(readEvent(reader)).resolves.toBeNull();
    expect(errorSpy).not.toHaveBeenCalledWith('api.stream.failed', expect.anything());
  });

  it('logs stream query failures and closes when enqueue fails after cancellation', async () => {
    vi.useFakeTimers();

    const failingDb = new FakeD1Database();
    failingDb.failLatest = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failedResponse = await request('/api/stream?to=hana', makeEnv({ DB: failingDb }));
    const failedReader = failedResponse.body!.getReader();

    await expect(readEvent(failedReader)).resolves.toContain('event: ready');
    await expect(readEvent(failedReader)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('api.stream.failed', {
      mailbox: 'hana@adopsee.com',
      error: expect.any(Error),
    });

    const db = new FakeD1Database();
    db.emails.push({
      id: 'first',
      id_to: 'hana@adopsee.com',
      id_from: 'sender@example.com',
      subject: 'Hello',
      body_text: 'body',
      body_html: '',
      preview: 'body',
      expires_at: null,
      timestamp: '2026-03-25 10:00:00',
    });

    const response = await request('/api/stream?to=hana', makeEnv({ DB: db }));
    const reader = response.body!.getReader();
    await readEvent(reader);
    await readEvent(reader);
    await reader.cancel();
    await vi.advanceTimersByTimeAsync(3000);
  });
});

describe('scheduled cleanup and email ingestion', () => {
  beforeEach(() => {
    resetRateLimitState();
    vi.restoreAllMocks();
  });

  it('cleans expired emails and propagates cleanup failures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T10:00:00Z'));

    const db = new FakeD1Database();
    db.emails.push(
      {
        id: 'expired',
        id_to: 'hana@adopsee.com',
        id_from: 'a@example.com',
        subject: 'Old',
        body_text: '',
        body_html: '',
        preview: null,
        expires_at: '2026-03-24 09:00:00',
        timestamp: '2026-03-24 09:00:00',
      },
      {
        id: 'fresh',
        id_to: 'hana@adopsee.com',
        id_from: 'b@example.com',
        subject: 'Fresh',
        body_text: '',
        body_html: '',
        preview: null,
        expires_at: '2026-03-26 09:00:00',
        timestamp: '2026-03-25 09:00:00',
      }
    );

    const env = makeEnv({ DB: db });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cleanupExpiredEmails(env as never);
    expect(db.emails.map((email) => email.id)).toEqual(['fresh']);
    expect(logSpy).toHaveBeenCalledWith('cleanup.completed', { deleted: 1, retentionDays: 7 });

    db.failCleanup = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(worker.scheduled({} as ScheduledController, env as never)).rejects.toThrow('cleanup failed');
    expect(errorSpy).toHaveBeenCalledWith('cleanup.failed', { error: expect.any(Error) });
  });

  it('stores parsed emails, rejects invalid recipients, and handles parser/db failures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T10:00:00Z'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await worker.email(
      {
        from: 'sender@example.com',
        raw: new Blob(['unused']),
      } as ForwardableEmailMessage,
      makeEnv() as never
    );
    expect(warnSpy).toHaveBeenCalledWith('email.rejected.invalid_recipient', { to: undefined });

    await worker.email(
      {
        to: 'bad@wrong.test',
        from: 'sender@example.com',
        raw: new Blob(['unused']),
      } as ForwardableEmailMessage,
      makeEnv() as never
    );
    expect(warnSpy).toHaveBeenCalledWith('email.rejected.invalid_recipient', { to: 'bad@wrong.test' });

    const parseErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await worker.email(
      {
        to: 'hana@adopsee.com',
        from: 'sender@example.com',
        raw: new ReadableStream({
          start(controller) {
            controller.error(new Error('raw failed'));
          },
        }),
      } as unknown as ForwardableEmailMessage,
      makeEnv() as never
    );
    expect(parseErrorSpy).toHaveBeenCalledWith('email.parse_failed', {
      to: 'hana@adopsee.com',
      error: expect.any(Error),
    });

    const db = new FakeD1Database();
    const successEnv = makeEnv({ DB: db, RETENTION_DAYS: '10' });
    const parsedSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await worker.email(
      {
        to: 'HaNa@adopsee.com',
        from: 'sender@example.com',
        raw: new Blob([
          'From: sender@example.com\r\n' +
            'To: hana@adopsee.com\r\n' +
            'Content-Type: text/html; charset=utf-8\r\n' +
            '\r\n' +
            '<p>Hello <b>Hana</b></p>',
        ]),
      } as ForwardableEmailMessage,
      successEnv as never
    );

    expect(db.emails).toHaveLength(1);
    expect(db.emails[0]?.id_to).toBe('hana@adopsee.com');
    expect(db.emails[0]?.id_from).toBe('sender@example.com');
    expect(db.emails[0]?.subject).toBe('(No Subject)');
    expect(db.emails[0]?.body_text).toBe('');
    expect(db.emails[0]?.body_html).toContain('<p>Hello <b>Hana</b></p>');
    expect(db.emails[0]?.preview).toBe('Hello Hana');
    expect(db.emails[0]?.expires_at).toBe('2026-04-04 10:00:00.000');
    expect(parsedSpy).toHaveBeenCalledWith('email.parsed', {
      to: 'hana@adopsee.com',
      from: 'sender@example.com',
      subject: '(No Subject)',
    });
    expect(parsedSpy).toHaveBeenCalledWith('email.stored', {
      to: 'hana@adopsee.com',
      from: 'sender@example.com',
    });

    db.failInsert = true;
    await worker.email(
      {
        to: 'hana@adopsee.com',
        from: 'sender@example.com',
        raw: new Blob([
          'From: sender@example.com\r\n' +
            'To: hana@adopsee.com\r\n' +
            'Subject: Stored?\r\n' +
            'Content-Type: text/plain; charset=utf-8\r\n' +
            '\r\n' +
            'Plain text body',
        ]),
      } as ForwardableEmailMessage,
      successEnv as never
    );
    expect(parseErrorSpy).toHaveBeenCalledWith('email.store_failed', {
      to: 'hana@adopsee.com',
      error: expect.any(Error),
    });
  });
});
