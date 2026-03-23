export function renderHomePage(mailDomain: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Temporary Mail Inbox</title>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
    <style>
      :root {
        --bg: #f7f8fc;
        --card: #ffffff;
        --text: #1f2937;
        --muted: #6b7280;
        --line: #e6e9f2;
        --accent: #4f46e5;
        --accent-soft: #eef0ff;
      }
      * { box-sizing: border-box; }
      body {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        max-width: 980px;
        margin: 0 auto;
        padding: 1.25rem;
        line-height: 1.5;
        color: var(--text);
        background: radial-gradient(circle at top left, #eef2ff 0%, var(--bg) 40%, var(--bg) 100%);
      }
      h1 { margin: 0; font-size: 1.8rem; }
      p.sub { margin: 0.35rem 0 1rem; color: var(--muted); }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 1rem;
        box-shadow: 0 8px 30px rgba(17, 24, 39, 0.05);
      }
      .selector { display: grid; gap: 0.7rem; }
      .input-wrap { position: relative; }
      input[type="text"] {
        width: 100%;
        padding: 0.72rem 8.8rem 0.72rem 0.78rem;
        border-radius: 10px;
        border: 1px solid #d8deea;
        font-size: 0.95rem;
        outline: none;
      }
      input[type="text"]:focus { border-color: #b5c3ff; box-shadow: 0 0 0 3px #eef1ff; }
      .domain-suffix {
        position: absolute;
        right: 2.5rem;
        top: 50%;
        transform: translateY(-50%);
        color: var(--muted);
        font-size: 0.9rem;
        pointer-events: none;
      }
      .dice-btn {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        border: 0;
        background: transparent;
        cursor: pointer;
        font-size: 1.05rem;
        line-height: 1;
        padding: 0.4rem;
        border-radius: 7px;
      }
      .dice-btn:hover { background: var(--accent-soft); }
      button {
        background: var(--accent);
        color: #fff;
        border: none;
        padding: 0.7rem 0.95rem;
        border-radius: 10px;
        cursor: pointer;
        font-weight: 600;
      }
      button:hover { filter: brightness(0.97); }
      .status { font-size: 0.9rem; color: var(--muted); margin-top: 0.25rem; }
      .email-list-wrap { margin-top: 1rem; }
      .inbox-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.65rem;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .email-item {
        background: #fff;
        padding: 0.95rem 1rem;
        margin-bottom: 0.65rem;
        border-radius: 12px;
        border: 1px solid var(--line);
        cursor: pointer;
        transition: all .16s ease;
      }
      .email-item:hover {
        border-color: #c7d2fe;
        box-shadow: 0 6px 18px rgba(79, 70, 229, 0.08);
        transform: translateY(-1px);
      }
      .email-row { display: flex; justify-content: space-between; gap: 0.75rem; align-items: center; }
      .subject { font-weight: 600; color: var(--text); }
      .meta { font-size: 0.82rem; color: var(--muted); }
      .snippet { margin-top: 0.35rem; color: #4b5563; font-size: 0.88rem; }
      .modal {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.5);
        display: none;
        justify-content: center;
        align-items: center;
        padding: 1rem;
      }
      .modal.show { display: flex; }
      .modal-content {
        background: #fff;
        border-radius: 14px;
        max-width: 92%;
        max-height: 90%;
        overflow: auto;
        width: 780px;
        border: 1px solid var(--line);
        padding: 1.1rem;
      }
      .text-body {
        white-space: pre-wrap;
        word-break: break-word;
        background: #fafbff;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 0.85rem;
        line-height: 1.5;
      }
    </style>
  </head>
  <body x-data="mailApp()" x-init="init()">
    <h1>Temporary Mail Inbox</h1>
    <p class="sub">Generate a mailbox and monitor incoming messages in real time.</p>

    <div class="card">
      <div class="selector">
        <div class="input-wrap">
          <input x-model="localPart" type="text" placeholder="email name" />
          <span class="domain-suffix">@${mailDomain}</span>
          <button class="dice-btn" @click.prevent="generateRandom()" title="Generate random inbox">🎲</button>
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
            <span class="meta" x-text="new Date(e.timestamp).toLocaleString()"></span>
          </div>
          <div class="meta" x-text="'From: ' + e.id_from"></div>
          <div class="snippet" x-text="previewText(e)"></div>
        </div>
      </template>
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
          selectedIsHtml: false,
          selectedPlainText: '',
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

          stripHtml(html) {
            return (html || '')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/\s+/g, ' ')
              .trim();
          },

          getPlainTextBody(email) {
            const text = (email?.body_text || '').trim();
            if (text) return text;
            const htmlAsText = this.stripHtml(email?.body_html || '');
            if (htmlAsText) return htmlAsText;
            return '';
          },

          previewText(email) {
            const base = this.getPlainTextBody(email) || (email?.body_html ? 'HTML email content' : 'No preview');
            return base.length > 120 ? (base.slice(0, 120) + '…') : base;
          },

          async init() {
            await this.generateRandom();
          },

          async generateRandom() {
            const res = await fetch('/api/mailbox/random');
            const data = await res.json();
            this.localPart = (data.mailbox || '').split('@')[0] || '';
            this.status = 'Random inbox ready. Click "Open Inbox" to start monitoring.';
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
            this.selectedIsHtml = !!(e.body_html && e.body_html.trim());
            this.selectedPlainText = this.getPlainTextBody(e);
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
    </script>
  </body>
</html>`;
}
