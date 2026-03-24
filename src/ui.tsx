/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

type HomePageProps = {
  mailDomain: string;
};

export function renderHomePage(mailDomain: string) {
  const appHtml = `
    <div class="hero">
      <div class="hero-badge">🌸 Hana Mail Workspace</div>
      <h1>Temporary Mail Inbox</h1>
      <p class="sub">Generate a mailbox and monitor incoming messages in real time.</p>
    </div>

    <div class="page-main">
      <div class="card">
        <div class="selector">
          <div class="input-wrap">
            <input x-model="localPart" @input="localPart = (localPart || '').toLowerCase()" type="text" placeholder="email name" />
            <span class="domain-suffix">@${mailDomain}</span>
            <button class="dice-btn" :class="{ 'is-rolling': diceRolling }" :disabled="diceRolling" @click.prevent="generateRandom()" title="Generate random inbox">🎲</button>
          </div>
          <button style="display:block;width:100%;" @click="activateInbox()">Open Inbox</button>
        </div>
        <div class="status" x-text="status"></div>
      </div>

      <div class="email-list-wrap" id="email-list" x-show="showInbox" style="display:none;">
        <div class="inbox-head">
          <span>Inbox: <b x-text="activeMailbox"></b></span>
          <span x-text="emails.length + ' message(s)'"></span>
        </div>
        <template x-if="emails.length === 0">
          <p style="text-align:center;">No emails yet for <b x-text="activeMailbox"></b>.</p>
        </template>
        <template x-for="e in emails" :key="e.id">
          <div class="email-item" @click="viewEmail(e.id)">
            <div class="email-row">
              <div class="subject" x-text="e.subject || '(No Subject)'"></div>
              <span class="meta" x-text="formatTimestamp(e.timestamp)"></span>
            </div>
            <div class="meta" x-text="'From: ' + e.id_from"></div>
            <div class="snippet" x-text="previewText(e)"></div>
          </div>
        </template>
      </div>
    </div>

    <div class="footer">
      Built for Cloudflare Workers · <a href="https://github.com/ai-hana-ai/hana-temp-mail" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
    </div>

    <div class="modal" :class="{ 'show': modalOpen }" @click="closeModal()">
      <div class="modal-content" @click.stop>
        <h2 x-text="selected?.subject || '(No Subject)'"></h2>
        <p class="meta" x-text="selected ? ('From: ' + selected.id_from + ' | To: ' + selected.id_to) : ''"></p>
        <hr style="border:0;border-top:1px solid #eee;" />

        <template x-if="selected && selectedIsHtml">
          <iframe id="email-html-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" style="width:100%;min-height:420px;border:1px solid #eee;border-radius:10px;background:#fff;"></iframe>
        </template>
        <template x-if="selected && !selectedIsHtml">
          <pre class="text-body" x-text="selectedPlainText || '(No message body)'"></pre>
        </template>

        <br>
        <button style="display:block;width:100%;" @click="closeModal()">Close</button>
      </div>
    </div>
  `;

  const appScript = `
      function mailApp() {
        return {
          mailDomain: ${JSON.stringify(mailDomain)},
          localPart: '',
          status: 'Preparing a random inbox...',
          showInbox: false,
          activeMailbox: '',
          emails: [],
          selected: null,
          selectedIsHtml: false,
          selectedPlainText: '',
          modalOpen: false,
          eventSource: null,
          diceRolling: false,

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

          normalizeSqliteTs(ts) {
            if (!ts) return '';
            if (typeof ts !== 'string') return ts;
            if (/Z$|[+-]\d\d:\d\d$/.test(ts)) return ts;
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(ts)) {
              return ts.replace(' ', 'T') + 'Z';
            }
            return ts;
          },

          formatTimestamp(ts) {
            const normalized = this.normalizeSqliteTs(ts);
            const d = new Date(normalized);
            if (Number.isNaN(d.getTime())) return String(ts || '');
            return d.toLocaleString();
          },

          stripHtml(html) {
            return (html || '')
              .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
              .replace(/<script[\\s\\S]*?<\\\/script>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/\\s+/g, ' ')
              .trim();
          },

          getPlainTextBody(email) {
            const text = (email?.body_text || '').trim();
            if (text) return text;
            const htmlAsText = this.stripHtml(email?.body_html || '');
            if (htmlAsText) return htmlAsText;
            return '';
          },

          hasMeaningfulHtml(email, plainText) {
            const html = (email?.body_html || '').trim();
            if (!html) return false;

            const normalize = (s) => (s || '')
              .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();

            const htmlAsText = normalize(this.stripHtml(html));
            const plain = normalize(plainText || '');
            if (!htmlAsText) return false;
            if (plain && htmlAsText === plain) return false;
            return true;
          },

          previewText(email) {
            const base = this.getPlainTextBody(email) || (email?.body_html ? 'HTML email content' : 'No preview');
            return base.length > 120 ? (base.slice(0, 120) + '…') : base;
          },

          async init() {
            await this.generateRandom();
          },

          async generateRandom() {
            if (this.diceRolling) return;
            this.diceRolling = true;
            try {
              const res = await fetch('/api/mailbox/random');
              const data = await res.json();
              this.localPart = (data.mailbox || '').split('@')[0] || '';
              this.status = 'Random inbox ready. Click "Open Inbox" to start monitoring.';
            } catch {
              this.status = 'Failed to generate random inbox. Please retry.';
            } finally {
              this.diceRolling = false;
            }
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
            this.selectedPlainText = this.getPlainTextBody(e);
            this.selectedIsHtml = this.hasMeaningfulHtml(e, this.selectedPlainText);
            this.modalOpen = true;

            setTimeout(() => {
              if (this.selectedIsHtml) {
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
            this.selectedIsHtml = false;
            this.selectedPlainText = '';
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
  `;

  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Temporary Mail Inbox</title>
        <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --bg: #f4f6ff;
            --bg-2: #eef2ff;
            --card: #ffffff;
            --text: #1f2937;
            --muted: #667085;
            --line: #e4e7f2;
            --accent: #6d5efc;
            --accent-2: #8b7dff;
            --accent-soft: #eef0ff;
          }
          * { box-sizing: border-box; }
          body {font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;max-width: 1040px;margin: 0 auto;padding: 1.25rem;line-height: 1.5;color: var(--text);background:radial-gradient(900px 480px at -10% -15%, #e8ecff 0%, transparent 60%),radial-gradient(760px 420px at 110% -10%, #f2eefe 0%, transparent 60%),linear-gradient(180deg, var(--bg-2) 0%, var(--bg) 48%, #f8f9ff 100%);min-height: 100dvh;display:flex;flex-direction:column;}
          h1 { margin: 0; font-size: 1.85rem; letter-spacing: -0.02em; }
          p.sub { margin: 0.45rem 0 1rem; color: var(--muted); }
          .hero { margin-bottom: 1rem; text-align:center; }
          .hero-badge { display:inline-flex;align-items:center;gap:.4rem;background:rgba(109, 94, 252, .1);color:#4f46e5;border:1px solid rgba(109, 94, 252, .18);border-radius:999px;padding:.25rem .65rem;font-size:.75rem;font-weight:700;margin:0 auto .55rem; }
          .card { background:linear-gradient(180deg, #fff 0%, #fcfcff 100%);border:1px solid var(--line);border-radius:16px;padding:1rem;box-shadow:0 10px 26px rgba(23,34,74,.07),0 1px 0 rgba(255,255,255,.8) inset; }
          .selector { display:grid; gap:.7rem; }
          .input-wrap { position:relative; }
          input[type="text"] { width:100%;padding:.72rem 8.8rem .72rem .78rem;border-radius:10px;border:1px solid #d8deea;font-size:.95rem;outline:none;text-transform:lowercase; }
          input[type="text"]:focus { border-color:#b5c3ff; box-shadow:0 0 0 3px #eef1ff; }
          .domain-suffix { position:absolute;right:2.9rem;top:50%;transform:translateY(-50%);color:#7b8197;font-size:.9rem;pointer-events:none; }
          .dice-btn { position:absolute;right:7px;top:50%;transform:translateY(-50%);border:0;background:transparent;box-shadow:none;cursor:pointer;font-size:1rem;line-height:1;width:1.95rem;height:1.95rem;display:inline-flex;align-items:center;justify-content:center;border-radius:8px; }
          .dice-btn:hover { background:transparent;transform:translateY(-50%); }
          .dice-btn.is-rolling { animation:dice-spin 700ms linear infinite; }
          @keyframes dice-spin { 0% { transform: translateY(-50%) rotate(0deg); } 100% { transform: translateY(-50%) rotate(360deg); } }
          button { background:linear-gradient(135deg,var(--accent) 0%,var(--accent-2) 100%);color:#fff;border:none;padding:.72rem .95rem;border-radius:11px;cursor:pointer;font-weight:700;letter-spacing:.01em;box-shadow:0 8px 20px rgba(109, 94, 252, .28); }
          button:hover { filter:brightness(1.02);transform:translateY(-.5px); }
          .status {font-size:.87rem;color:var(--muted);margin-top:.3rem;background:#f8f9ff;border:1px dashed #dce2f7;border-radius:10px;padding:.45rem .6rem; }
          .email-list-wrap { margin-top:1rem; }
          .page-main { flex:1; }
          .inbox-head { display:flex;justify-content:space-between;align-items:center;margin-bottom:.65rem;color:var(--muted);font-size:.9rem; }
          .email-item { background:linear-gradient(180deg,#fff 0%,#fdfdff 100%);padding:.95rem 1rem;margin-bottom:.65rem;border-radius:13px;border:1px solid var(--line);cursor:pointer;transition:all .16s ease; }
          .email-item:hover { border-color:#c9d0ff;box-shadow:0 10px 24px rgba(79,70,229,.11);transform:translateY(-1px); }
          .email-row { display:flex;justify-content:space-between;gap:.75rem;align-items:center; }
          .subject { font-weight:600; color:var(--text); }
          .meta { font-size:.82rem; color:var(--muted); }
          .snippet { margin-top:.35rem;color:#4b5563;font-size:.88rem; }
          .modal { position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;justify-content:center;align-items:center;padding:1rem; }
          .modal.show { display:flex; }
          .modal-content { background:#fff;border-radius:14px;max-width:92%;max-height:90%;overflow:auto;width:780px;border:1px solid var(--line);padding:1.1rem; }
          .text-body { white-space:pre-wrap;word-break:break-word;background:#fafbff;border:1px solid var(--line);border-radius:10px;padding:.85rem;line-height:1.5; }
          .footer { margin-top:1.1rem;text-align:center;color:var(--muted);font-size:.84rem;padding-top:.65rem;border-top:1px solid #e8ebf7; }
          .footer a { color: var(--accent); text-decoration:none; font-weight:600; }
          .footer a:hover { text-decoration:underline; }
        ` }} />
      </head>
      <body x-data="mailApp()" x-init="init()">
        <div dangerouslySetInnerHTML={{ __html: appHtml }} />
        <script dangerouslySetInnerHTML={{ __html: appScript }} />
      </body>
    </html>
  );
}

export function HomePage({ mailDomain }: HomePageProps) {
  return renderHomePage(mailDomain);
}
