/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { mailboxLocalPartPattern } from './validation';

type HomePageProps = {
  mailDomain: string;
};

export function HomePage({ mailDomain }: HomePageProps) {
  const mailboxLocalPartRegexSource = mailboxLocalPartPattern.source;
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

        <template x-if="isInboxLoading">
          <div class="stack-sm">
            <template x-for="n in skeletonItems" :key="'email-skeleton-' + n">
              <div class="email-item email-skeleton" aria-hidden="true">
                <div class="email-row">
                  <div class="skeleton-line skeleton-subject"></div>
                  <div class="skeleton-line skeleton-meta"></div>
                </div>
                <div class="skeleton-line skeleton-from"></div>
                <div class="skeleton-line skeleton-snippet"></div>
                <div class="skeleton-line skeleton-snippet short"></div>
              </div>
            </template>
          </div>
        </template>

        <template x-if="!isInboxLoading && emails.length === 0">
          <div class="empty-state">
            <div class="empty-icon">✉️</div>
            <div class="empty-copy">
              <h3>Your inbox is empty</h3>
              <p>No emails have arrived at <b x-text="activeMailbox"></b> yet. Share this address or wait a moment. The inbox refreshes automatically when new messages arrive.</p>
            </div>
          </div>
        </template>

        <template x-if="!isInboxLoading && emails.length > 0">
          <div>
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

        <template x-if="isEmailLoading">
          <div class="modal-skeleton" aria-hidden="true">
            <div class="skeleton-line skeleton-heading"></div>
            <div class="skeleton-line skeleton-meta wide"></div>
            <div class="skeleton-block"></div>
            <div class="skeleton-line skeleton-snippet"></div>
            <div class="skeleton-line skeleton-snippet short"></div>
          </div>
        </template>

        <template x-if="selected && !isEmailLoading && selectedIsHtml">
          <iframe id="email-html-frame" sandbox="allow-popups" referrerpolicy="no-referrer" style="width:100%;min-height:420px;border:1px solid #eee;border-radius:10px;background:#fff;"></iframe>
        </template>
        <template x-if="selected && !isEmailLoading && !selectedIsHtml">
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
        isInboxLoading: false,
        isEmailLoading: false,
        eventSource: null,
        beforeUnloadHandler: null,
        diceRolling: false,
        skeletonItems: [1, 2, 3],
        inboxLoadSeq: 0,

        normalizeLocalPart(v) {
          const val = (v || '').trim().toLowerCase();
          if (!val) return null;
          if (val.includes('@')) return null;
          if (!(new RegExp(${JSON.stringify(mailboxLocalPartRegexSource)})).test(val)) return null;
          return val;
        },

        toMailbox(localPart) {
          return localPart + '@' + this.mailDomain;
        },

        waitForPaint() {
          return new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          });
        },

        async beginInboxLoad() {
          this.inboxLoadSeq += 1;
          const loadSeq = this.inboxLoadSeq;
          this.isInboxLoading = true;
          this.emails = [];
          await this.waitForPaint();
          return loadSeq;
        },

        normalizeSqliteTs(ts) {
          if (!ts) return '';
          if (typeof ts !== 'string') return ts;
          if (/Z$|[+-]\\d\\d:\\d\\d$/.test(ts)) return ts;
          if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(\\.\\d+)?$/.test(ts)) {
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
            .replace(/<!--[\\s\\S]*?-->/g, ' ')
            .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
            .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
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
            .replace(/[\\u00A0\\u200B-\\u200D\\uFEFF]/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim()
            .toLowerCase();

          const htmlAsText = normalize(this.stripHtml(html));
          const plain = normalize(plainText || '');
          if (!htmlAsText) return false;
          if (plain && htmlAsText === plain) return false;
          return true;
        },

        previewText(email) {
          const base = (email?.preview || '').trim() || 'No preview available';
          return base.length > 120 ? (base.slice(0, 120) + '...') : base;
        },

        getErrorMessage(payload, fallback) {
          if (payload && typeof payload.error === 'string') return payload.error;
          if (payload && payload.error && typeof payload.error.message === 'string') return payload.error.message;
          return fallback;
        },

        sanitizeEmailHtml(html) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html || '', 'text/html');
          const blockedTags = ['script', 'iframe', 'object', 'embed', 'base', 'form', 'input', 'button', 'select', 'option', 'textarea', 'link', 'meta'];
          blockedTags.forEach((tag) => {
            doc.querySelectorAll(tag).forEach((node) => node.remove());
          });

          const allowedProtocols = ['http:', 'https:', 'mailto:', 'cid:', 'data:'];
          const urlAttributes = ['href', 'src', 'poster', 'action', 'formaction'];

          doc.querySelectorAll('*').forEach((node) => {
            for (const attr of Array.from(node.attributes)) {
              const name = attr.name.toLowerCase();
              const value = attr.value.trim();

              if (name.startsWith('on') || name === 'srcdoc') {
                node.removeAttribute(attr.name);
                continue;
              }

              if (name === 'style' && /expression|url\\s*\\(/i.test(value)) {
                node.removeAttribute(attr.name);
                continue;
              }

              if (name === 'target') {
                node.setAttribute('target', '_blank');
                continue;
              }

              if (urlAttributes.includes(name)) {
                if (!value) continue;

                try {
                  const parsed = new URL(value, 'https://mail.invalid');
                  if (!allowedProtocols.includes(parsed.protocol)) {
                    node.removeAttribute(attr.name);
                  }
                } catch {
                  node.removeAttribute(attr.name);
                }
              }
            }

            if (node.tagName === 'A') {
              node.setAttribute('rel', 'noopener noreferrer');
              node.setAttribute('target', '_blank');
            }
          });

          return doc.body.innerHTML.trim();
        },

        buildHtmlDocument(emailHtml) {
          const sanitized = this.sanitizeEmailHtml(emailHtml);
          const body = sanitized || '<p style="font-family: ui-sans-serif, system-ui, sans-serif; color: #475467;">HTML body was empty after sanitization.</p>';
          return [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '<meta charset="utf-8">',
            '<meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'; img-src data: http: https: cid:; media-src data: http: https:; style-src \\'unsafe-inline\\'; font-src data: http: https:; frame-src http: https:; connect-src \\'none\\'; script-src \\'none\\'; base-uri \\'none\\'; form-action \\'none\\'">',
            '<meta name="referrer" content="no-referrer">',
            '<base target="_blank">',
            '<style>html,body{margin:0;padding:0;background:#fff;color:#111827}body{padding:16px;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}img{max-width:100%;height:auto}pre{white-space:pre-wrap;word-break:break-word}</style>',
            '</head>',
            '<body>',
            body,
            '</body>',
            '</html>',
          ].join('');
        },

        renderSelectedHtml(emailHtml) {
          const frame = document.getElementById('email-html-frame');
          if (frame) {
            frame.setAttribute('srcdoc', this.buildHtmlDocument(emailHtml));
          }
        },

        async generateRandom() {
          if (this.diceRolling) return;
          this.diceRolling = true;
          try {
            const res = await fetch('/api/mailbox/random');
            const data = await res.json();
            if (!res.ok) throw new Error(this.getErrorMessage(data, 'Failed to generate random inbox.'));
            this.localPart = (data.mailbox || '').split('@')[0] || '';
            this.status = 'Random inbox ready. Click "Open Inbox" to start monitoring.';
          } catch (error) {
            this.status = error instanceof Error ? error.message : 'Failed to generate random inbox. Please retry.';
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
          this.status = 'Loading inbox...';
          await this.loadEmails();
          this.connectSSE();
        },

        async loadEmails() {
          if (!this.activeMailbox) return;
          const loadSeq = await this.beginInboxLoad();
          try {
            const res = await fetch('/api/emails?to=' + encodeURIComponent(this.activeMailbox));
            const data = await res.json();
            if (!res.ok) throw new Error(this.getErrorMessage(data, 'Failed to load emails.'));
            if (loadSeq !== this.inboxLoadSeq) return;
            this.emails = Array.isArray(data) ? data : [];
            await this.waitForPaint();
            this.status = 'Monitoring: ' + this.activeMailbox + ' (real-time active)';
          } catch (error) {
            if (loadSeq !== this.inboxLoadSeq) return;
            this.status = error instanceof Error ? error.message : 'Failed to load emails.';
          } finally {
            if (loadSeq === this.inboxLoadSeq) {
              this.isInboxLoading = false;
            }
          }
        },

        async viewEmail(id) {
          if (!this.activeMailbox) return;
          this.modalOpen = true;
          this.isEmailLoading = true;
          this.selected = null;
          this.selectedIsHtml = false;
          this.selectedPlainText = '';

          try {
            const res = await fetch('/api/email/' + id + '?to=' + encodeURIComponent(this.activeMailbox));
            const e = await res.json();
            if (!res.ok) throw new Error(this.getErrorMessage(e, 'Failed to load email.'));

            this.selected = e;
            this.selectedPlainText = this.getPlainTextBody(e);
            this.selectedIsHtml = this.hasMeaningfulHtml(e, this.selectedPlainText);

            setTimeout(() => {
              if (this.selectedIsHtml) {
                this.renderSelectedHtml(e.body_html || '');
              }
            }, 0);
          } catch (error) {
            this.closeModal();
            alert(error instanceof Error ? error.message : 'Failed to load email.');
          } finally {
            this.isEmailLoading = false;
          }
        },

        closeModal() {
          this.modalOpen = false;
          this.isEmailLoading = false;
          this.selected = null;
          this.selectedIsHtml = false;
          this.selectedPlainText = '';
          const frame = document.getElementById('email-html-frame');
          if (frame) frame.removeAttribute('srcdoc');
        },

        closeSSE() {
          if (!this.eventSource) return;
          this.eventSource.close();
          this.eventSource = null;
        },

        connectSSE() {
          if (!this.activeMailbox) return;
          this.closeSSE();

          this.eventSource = new EventSource('/api/stream?to=' + encodeURIComponent(this.activeMailbox));

          this.eventSource.addEventListener('ready', () => {
            this.status = 'Monitoring: ' + this.activeMailbox + ' (real-time active)';
          });

          this.eventSource.addEventListener('update', () => {
            this.loadEmails();
          });

          this.eventSource.onerror = () => {
            if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
              this.closeSSE();
            }
            this.status = 'Realtime connection interrupted, reconnecting...';
          };
        },

        destroy() {
          this.closeSSE();
          if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
            this.beforeUnloadHandler = null;
          }
        },

        async init() {
          this.beforeUnloadHandler = () => this.closeSSE();
          window.addEventListener('beforeunload', this.beforeUnloadHandler);
          await this.generateRandom();
        },
      };
    }
  `;

  const css = `
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
    html { min-height: 100%; }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      max-width: 1040px;
      margin: 0 auto;
      padding: 1.25rem;
      line-height: 1.5;
      color: var(--text);
      background:
        radial-gradient(900px 480px at -10% -15%, #e8ecff 0%, transparent 60%),
        radial-gradient(760px 420px at 110% -10%, #f2eefe 0%, transparent 60%),
        linear-gradient(180deg, var(--bg-2) 0%, var(--bg) 48%, #f8f9ff 100%);
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
    }
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
    .stack-sm { display:grid; gap:.65rem; }
    .page-main { flex:1; }
    .inbox-head { display:flex;justify-content:space-between;align-items:center;margin-bottom:.65rem;color:var(--muted);font-size:.9rem; }
    .email-item { background:linear-gradient(180deg,#fff 0%,#fdfdff 100%);padding:.95rem 1rem;margin-bottom:.65rem;border-radius:13px;border:1px solid var(--line);cursor:pointer;transition:all .16s ease; }
    .email-item:hover { border-color:#c9d0ff;box-shadow:0 10px 24px rgba(79,70,229,.11);transform:translateY(-1px); }
    .email-row { display:flex;justify-content:space-between;gap:.75rem;align-items:center; }
    .subject { font-weight:600; color:var(--text); }
    .meta { font-size:.82rem; color:var(--muted); }
    .snippet { margin-top:.35rem;color:#4b5563;font-size:.88rem; }
    .empty-state {
      display:grid;
      place-items:center;
      text-align:center;
      gap:.85rem;
      padding:2rem 1.25rem;
      background:linear-gradient(180deg, rgba(255,255,255,.9) 0%, rgba(247,248,255,.95) 100%);
      border:1px solid var(--line);
      border-radius:18px;
      box-shadow:0 18px 32px rgba(109,94,252,.08);
    }
    .empty-icon {
      width:3.5rem;
      height:3.5rem;
      display:grid;
      place-items:center;
      border-radius:1.2rem;
      background:radial-gradient(circle at 30% 30%, #ffffff 0%, #f3f1ff 42%, #e7ebff 100%);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.8), 0 10px 24px rgba(109,94,252,.12);
      font-size:1.4rem;
    }
    .empty-copy { max-width:34rem; }
    .empty-copy h3 { margin:0 0 .3rem; font-size:1.05rem; letter-spacing:-.01em; }
    .empty-copy p { margin:0; color:#5b6477; font-size:.93rem; }
    .email-skeleton { cursor:default; pointer-events:none; }
    .email-skeleton:hover { border-color:var(--line); box-shadow:none; transform:none; }
    .skeleton-line,
    .skeleton-block {
      position:relative;
      overflow:hidden;
      background:linear-gradient(90deg, #eef2ff 0%, #f8f9ff 50%, #eef2ff 100%);
      background-size:200% 100%;
      animation:skeleton-shimmer 1.4s ease-in-out infinite;
      border-radius:999px;
    }
    .skeleton-line { height:.8rem; }
    .skeleton-subject { width:58%; height:1rem; }
    .skeleton-meta { width:22%; }
    .skeleton-from { width:38%; margin-top:.8rem; }
    .skeleton-snippet { width:100%; margin-top:.7rem; }
    .skeleton-snippet.short { width:74%; }
    .skeleton-heading { width:42%; height:1.1rem; margin-bottom:.75rem; }
    .skeleton-meta.wide { width:68%; margin-bottom:1rem; }
    .skeleton-block {
      width:100%;
      height:18rem;
      border-radius:18px;
      margin-bottom:1rem;
      border:1px solid #edf1ff;
    }
    .modal-skeleton { padding:.2rem 0 .4rem; }
    @keyframes skeleton-shimmer {
      0% { background-position:200% 0; }
      100% { background-position:-200% 0; }
    }
    .modal { position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;justify-content:center;align-items:center;padding:1rem; }
    .modal.show { display:flex; }
    .modal-content { background:#fff;border-radius:14px;max-width:92%;max-height:90%;overflow:auto;width:780px;border:1px solid var(--line);padding:1.1rem; }
    .text-body { white-space:pre-wrap;word-break:break-word;background:#fafbff;border:1px solid var(--line);border-radius:10px;padding:.85rem;line-height:1.5; }
    .footer { margin-top:1.1rem;text-align:center;color:var(--muted);font-size:.84rem;padding-top:.65rem;border-top:1px solid #e8ebf7; }
    .footer a { color: var(--accent); text-decoration:none; font-weight:600; }
    .footer a:hover { text-decoration:underline; }
  `;

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
        />
        <style dangerouslySetInnerHTML={{ __html: `[x-cloak] { display: none !important; }` }} />
        <title>Temporary Mail Inbox</title>
        <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js" integrity="sha384-9Ax3MmS9AClxJyd5/zafcXXjxmwFhZCdsT6HJoJjarvCaAkJlk5QDzjLJm+Wdx5F" crossorigin="anonymous"></script>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body x-data="mailApp()" x-init="init()" x-cloak>
        <div dangerouslySetInnerHTML={{ __html: appHtml }} />
        <script dangerouslySetInnerHTML={{ __html: appScript }} />
      </body>
    </html>
  );
}

export function renderHomePage(mailDomain: string) {
  return '<!DOCTYPE html>' + <HomePage mailDomain={mailDomain} />;
}
