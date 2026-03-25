import { Context, Hono } from 'hono';
import PostalMime from 'postal-mime';
import { renderHomePage } from './ui.tsx';
import { normalizeMailboxInput } from './validation';

export interface Env {
  DB: D1Database;
  MAIL_DOMAIN?: string;
  RETENTION_DAYS?: string;
  RATE_LIMIT_WINDOW_MS?: string;
}

type Bindings = { Bindings: Env };

const app = new Hono<Bindings>();
const rateLimitState = new Map<string, { count: number; resetAt: number }>();
let nextRateLimitCleanupAt = 0;

const RATE_LIMITS = {
  random: 24,
  inboxList: 60,
  emailDetail: 120,
  stream: 12,
} as const;

export function getMailDomain(env: Env): string {
  return (env.MAIL_DOMAIN || 'adopsee.com').trim().toLowerCase();
}

export function normalizeMailbox(input: string | null, mailDomain: string): string | null {
  return normalizeMailboxInput(input, mailDomain);
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

export async function cleanupExpiredEmails(env: Env) {
  try {
    const result = await env.DB.prepare("DELETE FROM emails WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
    console.log('cleanup.completed', { deleted: result.meta.changes, retentionDays: getRetentionDays(env) });
  } catch (error) {
    console.error('cleanup.failed', { error });
    throw error;
  }
}

app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  const bucket: keyof typeof RATE_LIMITS =
    path === '/api/mailbox/random'
      ? 'random'
      : path === '/api/stream'
        ? 'stream'
        : path.startsWith('/api/email/')
          ? 'emailDetail'
          : 'inboxList';

  const limited = applyRateLimit(c, bucket);
  if (limited) return limited;
  await next();
});

app.get('/api/mailbox/random', (c) => {
  const mailDomain = getMailDomain(c.env);
  return c.json({ mailbox: randomMailbox(mailDomain), domain: mailDomain });
});

app.get('/api/emails', async (c) => {
  const mailDomain = getMailDomain(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomain);
  if (!mailbox) {
    return jsonError(c, 400, 'invalid_mailbox', `Query parameter \`to\` must be a valid mailbox for @${mailDomain}.`);
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
  const mailDomain = getMailDomain(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomain);

  if (!id || !mailbox) {
    return jsonError(c, 400, 'invalid_request', `Email id and query parameter \`to\` (@${mailDomain}) are required.`);
  }

  try {
    const email = await c.env.DB.prepare('SELECT * FROM emails WHERE id = ? AND id_to = ?')
      .bind(id, mailbox)
      .first();

    if (!email) return jsonError(c, 404, 'not_found', 'Email not found.');
    return c.json(email);
  } catch (error) {
    console.error('api.email.detail_failed', { mailbox, id, error });
    return jsonError(c, 500, 'db_error', 'Failed to load email.');
  }
});

app.get('/api/stream', async (c) => {
  const mailDomain = getMailDomain(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomain);

  if (!mailbox) {
    return jsonError(c, 400, 'invalid_mailbox', `Missing or invalid \`to\` query parameter. Use @${mailDomain}.`);
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
  const mailDomain = getMailDomain(c.env);
  return c.html(renderHomePage(mailDomain));
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
  },
  async email(message: ForwardableEmailMessage, env: Env) {
    const mailDomain = getMailDomain(env);
    const normalizedTo = normalizeMailbox(message.to || '', mailDomain);
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
