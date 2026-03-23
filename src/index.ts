import { Hono } from 'hono';
import PostalMime from 'postal-mime';

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
  return c.html(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Adopsee Temporary Inbox</title>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
    <style>
      body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 920px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; background: #fff7fa; color: #29303a; }
      h1 { color: #d94f7d; text-align: center; margin-bottom: 0.45rem; font-size: 1.8rem; }
      p.sub { text-align: center; margin-top: 0; color: #566072; }
      .card { background: #fff; border: 1px solid #ffdce8; border-radius: 12px; padding: 1rem; box-shadow: 0 2px 10px rgba(0,0,0,0.03); }
      .selector { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
      .input-wrap { position: relative; flex: 1; min-width: 260px; }
      input[type="text"] { width: 100%; box-sizing: border-box; padding: 0.64rem 8.8rem 0.64rem 0.75rem; border-radius: 8px; border: 1px solid #ffd0db; font-size: 0.95rem; }
      .domain-suffix { position: absolute; right: 2.4rem; top: 50%; transform: translateY(-50%); color: #7a8394; font-size: 0.9rem; pointer-events: none; background: #fff; padding: 0 0.15rem; }
      .dice-btn { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: 0; background: transparent; cursor: pointer; font-size: 1.05rem; line-height: 1; padding: 0.35rem; border-radius: 6px; }
      .dice-btn:hover { background: #ffe7ef; }
      button { background: #d94f7d; color: #fff; border: none; padding: 0.6rem 0.95rem; border-radius: 8px; cursor: pointer; font-weight: 600; }
      button.secondary { background: #f3a8c0; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      .status { font-size: 0.9rem; color: #5f697a; margin-top: 0.75rem; }
      .email-item { background: #fff; padding: 1rem; margin-bottom: 0.8rem; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); cursor: pointer; border: 1px solid #ffeef1; }
      .email-item:hover { background: #fff3f7; }
      .meta { font-size: 0.82rem; color: #7a8394; }
      #email-list { margin-top: 1rem; }
      .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: none; justify-content: center; align-items: center; padding: 1rem; }
      .modal.show { display: flex; }
      .modal-content { background: #fff; padding: 1.5rem; border-radius: 12px; max-width: 90%; max-height: 90%; overflow: auto; width: 760px; }
    </style>
  </head>
  <body x-data="mailApp()" x-init="init()">
    <h1>Adopsee Temporary Inbox</h1>
    <p class="sub">Select an inbox address to start monitoring incoming emails in real-time.</p>

    <div class="card">
      <div class="selector">
        <div class="input-wrap">
          <input x-model="localPart" type="text" placeholder="email name" />
          <span class="domain-suffix">@${mailDomain}</span>
          <button class="dice-btn" @click.prevent="generateRandom()" title="Generate random inbox">🎲</button>
        </div>
        <button @click="activateInbox()">Use this inbox</button>
        <button class="secondary" :disabled="!activeMailbox" @click="loadEmails()">Refresh</button>
      </div>
      <div class="status" x-text="status"></div>
    </div>

    <div id="email-list" x-show="showInbox" style="display:none;">
      <template x-if="emails.length === 0">
        <p style="text-align:center;">No emails yet for <b x-text="activeMailbox"></b>.</p>
      </template>
      <template x-for="e in emails" :key="e.id">
        <div class="email-item" @click="viewEmail(e.id)">
          <strong x-text="e.subject || '(No Subject)'"></strong><br>
          <span class="meta" x-text="'From: ' + e.id_from + ' | To: ' + e.id_to"></span><br>
          <span class="meta" x-text="new Date(e.timestamp).toLocaleString()"></span>
        </div>
      </template>
    </div>

    <div class="modal" :class="{ 'show': modalOpen }" @click="closeModal()">
      <div class="modal-content" @click.stop>
        <h2 x-text="selected?.subject || '(No Subject)'"></h2>
        <p class="meta" x-text="selected ? ('From: ' + selected.id_from + ' | To: ' + selected.id_to) : ''"></p>
        <hr style="border:0;border-top:1px solid #eee;" />
        <template x-if="selected && selected.body_html">
          <iframe id="email-html-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" style="width:100%;min-height:420px;border:1px solid #eee;border-radius:8px;background:#fff;"></iframe>
        </template>
        <template x-if="selected && !selected.body_html">
          <div x-html="(selected?.body_text || '').replace(/\n/g, '<br>')"></div>
        </template>
        <br>
        <button @click="closeModal()">Close</button>
      </div>
    </div>

    <script>
      function mailApp() {
        return {
          mailDomain: ${JSON.stringify(mailDomain)},
          localPart: '',
          status: 'Preparing a random inbox...',
          showInbox: false,
          activeMailbox: '',
          emails: [],
          selected: null,
          modalOpen: false,
          eventSource: null,

          normalizeLocalPart(v) {
            const val = (v || '').trim().toLowerCase();
            if (!val) return null;
            if (val.includes('@')) return null;
            if (!/^[a-z0-9._-]+$/.test(val)) return null;
            return val;
          },

          toMailbox(localPart) {
            return localPart + '@' + this.mailDomain;
          },

          async init() {
            await this.generateRandom();
          },

          async generateRandom() {
            const res = await fetch('/api/mailbox/random');
            const data = await res.json();
            this.localPart = (data.mailbox || '').split('@')[0] || '';
            this.status = 'Random inbox ready. Click "Use this inbox" to start monitoring.';
          },

          async activateInbox() {
            const local = this.normalizeLocalPart(this.localPart);
            if (!local) {
              alert('Please input email name only (without @), e.g. john.doe');
              return;
            }

            this.localPart = local;
            this.activeMailbox = this.toMailbox(local);
            this.showInbox = true;
            await this.loadEmails();
            this.connectSSE();
          },

          async loadEmails() {
            if (!this.activeMailbox) return;
            const res = await fetch('/api/emails?to=' + encodeURIComponent(this.activeMailbox));
            const data = await res.json();
            this.emails = Array.isArray(data) ? data : [];
          },

          async viewEmail(id) {
            if (!this.activeMailbox) return;
            const res = await fetch('/api/email/' + id + '?to=' + encodeURIComponent(this.activeMailbox));
            const e = await res.json();
            if (e.error) return alert(e.error);

            this.selected = e;
            this.modalOpen = true;

            setTimeout(() => {
              if (e.body_html) {
                const frame = document.getElementById('email-html-frame');
                if (frame && frame.contentWindow) {
                  const doc = frame.contentWindow.document;
                  doc.open();
                  doc.write('<base target="_blank">' + e.body_html);
                  doc.close();
                }
              }
            }, 0);
          },

          closeModal() {
            this.modalOpen = false;
            this.selected = null;
          },

          connectSSE() {
            if (!this.activeMailbox) return;
            if (this.eventSource) this.eventSource.close();

            this.eventSource = new EventSource('/api/stream?to=' + encodeURIComponent(this.activeMailbox));

            this.eventSource.addEventListener('ready', () => {
              this.status = 'Monitoring: ' + this.activeMailbox + ' (real-time active)';
            });

            this.eventSource.addEventListener('update', () => {
              this.loadEmails();
            });

            this.eventSource.onerror = () => {
              this.status = 'Realtime connection interrupted, reconnecting...';
            };
          },
        };
      }
    </script>
  </body>
</html>`);
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
