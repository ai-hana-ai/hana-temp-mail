import { Hono } from 'hono';
import PostalMime from 'postal-mime';
import { renderHomePage } from './ui.tsx';

export interface Env {
  DB: D1Database;
  MAIL_DOMAIN?: string;
}

type Bindings = { Bindings: Env };

const app = new Hono<Bindings>();

function getMailDomain(env: Env): string {
  return (env.MAIL_DOMAIN || 'adopsee.com').trim().toLowerCase();
}

function normalizeMailbox(input: string | null, mailDomain: string): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    if (!local || !domain) return null;
    if (domain !== mailDomain) return null;
    return `${local}@${mailDomain}`;
  }

  return `${value}@${mailDomain}`;
}

function randomLocalPart(length = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function randomMailbox(mailDomain: string): string {
  return `${randomLocalPart()}@${mailDomain}`;
}

app.get('/api/mailbox/random', (c) => {
  const mailDomain = getMailDomain(c.env);
  return c.json({ mailbox: randomMailbox(mailDomain), domain: mailDomain });
});

app.get('/api/emails', async (c) => {
  const mailDomain = getMailDomain(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomain);
  if (!mailbox) {
    return c.json({ error: `Query parameter \`to\` harus email @${mailDomain}.` }, 400);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM emails WHERE lower(id_to) = ? ORDER BY timestamp DESC LIMIT ?'
  )
    .bind(mailbox.toLowerCase(), 50)
    .all();

  return c.json(results);
});

app.get('/api/email/:id', async (c) => {
  const id = c.req.param('id');
  const mailDomain = getMailDomain(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomain);

  if (!id || !mailbox) {
    return c.json({ error: `Email id dan query parameter \`to\` (@${mailDomain}) wajib.` }, 400);
  }

  const email = await c.env.DB.prepare('SELECT * FROM emails WHERE id = ? AND lower(id_to) = ?')
    .bind(id, mailbox.toLowerCase())
    .first();

  if (!email) return c.json({ error: 'Email not found.' }, 404);
  return c.json(email);
});

app.get('/api/stream', async (c) => {
  const mailDomain = getMailDomain(c.env);
  const mailbox = normalizeMailbox(c.req.query('to') || null, mailDomain);

  if (!mailbox) {
    return new Response(`Missing/invalid \`to\` query parameter. Use @${mailDomain}`, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const writeEvent = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      writeEvent('ready', { mailbox });

      let lastSeen = '';
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      try {
        while (!closed) {
          const latest = await c.env.DB.prepare(
            'SELECT timestamp FROM emails WHERE lower(id_to) = ? ORDER BY timestamp DESC LIMIT 1'
          )
            .bind(mailbox.toLowerCase())
            .first<{ timestamp: string }>();

          const latestTs = latest?.timestamp || '';
          if (latestTs && latestTs !== lastSeen) {
            lastSeen = latestTs;
            writeEvent('update', { at: latestTs });
          } else {
            writeEvent('ping', { t: Date.now() });
          }

          await sleep(3000);
        }
      } catch {
        // ignore disconnect errors
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // noop
        }
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

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Env) {
    const mailDomain = getMailDomain(env);
    const normalizedTo = normalizeMailbox(message.to || '', mailDomain);
    if (!normalizedTo) return;

    const parser = new PostalMime();
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const email = await parser.parse(rawEmail);

    await env.DB.prepare(
      'INSERT INTO emails (id, id_to, id_from, subject, body_text, body_html) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(
        crypto.randomUUID(),
        normalizedTo,
        message.from,
        email.subject || '(No Subject)',
        email.text || '',
        email.html || ''
      )
      .run();
  },
};
