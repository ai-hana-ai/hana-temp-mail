/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { mailboxLocalPartPattern } from './validation';

type HomePageProps = {
  mailDomain: string;
  mailDomains: string[];
  passkeyEnabled?: boolean;
};

export function HomePage({ mailDomain, mailDomains, passkeyEnabled = false }: HomePageProps) {
  const mailboxLocalPartRegexSource = mailboxLocalPartPattern.source;
  const appScript = `
    import { html, reactive, watch } from 'https://esm.sh/@arrow-js/core';
    import { 
      startRegistration, 
      startAuthentication 
    } from 'https://esm.sh/@simplewebauthn/browser';

    const mailDomain = ${JSON.stringify(mailDomain)};
    const availableMailDomains = ${JSON.stringify(mailDomains)};
    const passkeyEnabled = ${JSON.stringify(passkeyEnabled)};
    const mailboxLocalPartPattern = new RegExp(${JSON.stringify(mailboxLocalPartRegexSource)});
    const defaultMailDomain = availableMailDomains[0] || mailDomain;
    const root = document.getElementById('app');

    if (!root) {
      throw new Error('Missing app root');
    }

    const state = reactive({
      localPart: '',
      selectedDomain: defaultMailDomain,
      availableDomains: availableMailDomains,
      status: 'Ready.',
      showInbox: false,
      activeMailbox: '',
      emails: [],
      selected: null,
      selectedId: null,
      selectedIsHtml: false,
      selectedPlainText: '',
      modalOpen: false,
      isDesktopLayout: false,
      isInboxLoading: false,
      isEmailLoading: false,
      eventSource: null,
      diceRolling: false,
      skeletonItems: [1, 2, 3],
      inboxLoadSeq: 0,
      inboxBodyVersion: 0,
      emailLoadSeq: 0,
      htmlRenderSeq: 0,
      
      // Auth State
      auth: {
        enabled: passkeyEnabled,
        hasOwner: false,
        authenticated: !passkeyEnabled,
        loading: passkeyEnabled
      }
    });

    const waitForPaint = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    const normalizeLocalPart = (value) => {
      const normalized = (value || '').trim().toLowerCase();
      if (!normalized) return null;
      if (normalized.includes('@')) return null;
      if (!mailboxLocalPartPattern.test(normalized)) return null;
      return normalized;
    };

    const toMailbox = (localPart) => localPart + '@' + (state.selectedDomain || defaultMailDomain);

    const normalizeSqliteTs = (ts) => {
      if (!ts) return '';
      if (typeof ts !== 'string') return ts;
      if (/Z$|[+-]\\d\\d:\\d\\d$/.test(ts)) return ts;
      if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(\\.\\d+)?$/.test(ts)) {
        return ts.replace(' ', 'T') + 'Z';
      }
      return ts;
    };

    const formatTimestamp = (ts) => {
      const normalized = normalizeSqliteTs(ts);
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) return String(ts || '');
      return date.toLocaleString();
    };

    const stripHtml = (value) => {
      return (value || '')
        .replace(/<!--[\\s\\S]*?-->/g, ' ')
        .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
        .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\\s+/g, ' ')
        .trim();
    };

    const getPlainTextBody = (email) => {
      const text = (email?.body_text || '').trim();
      if (text) return text;
      const htmlAsText = stripHtml(email?.body_html || '');
      if (htmlAsText) return htmlAsText;
      return '';
    };

    const hasMeaningfulHtml = (email, plainText) => {
      const htmlBody = (email?.body_html || '').trim();
      if (!htmlBody) return false;

      const normalize = (value) => (value || '')
        .replace(/[\\u00A0\\u200B-\\u200D\\uFEFF]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim()
        .toLowerCase();

      const htmlAsText = normalize(stripHtml(htmlBody));
      const plain = normalize(plainText || '');
      if (!htmlAsText) return false;
      if (plain && htmlAsText === plain) return false;
      return true;
    };

    const previewText = (email) => {
      const base = (email?.preview || '').trim() || 'No preview available';
      return base.length > 120 ? (base.slice(0, 120) + '...') : base;
    };

    const getErrorMessage = (payload, fallback) => {
      if (payload && typeof payload.error === 'string') return payload.error;
      if (payload && payload.error && typeof payload.error.message === 'string') return payload.error.message;
      return fallback;
    };

    const sanitizeEmailHtml = (unsafeHtml) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(unsafeHtml || '', 'text/html');
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
    };

    const buildHtmlDocument = (emailHtml) => {
      const sanitized = sanitizeEmailHtml(emailHtml);
      const body = sanitized || '<p style=\"font-family: ui-sans-serif, system-ui, sans-serif; color: #475467;\">HTML body was empty after sanitization.</p>';
      return [
        '<!DOCTYPE html>',
        '<html lang=\"en\">',
        '<head>',
        '<meta charset=\"utf-8\">',
        '<meta http-equiv=\"Content-Security-Policy\" content=\"default-src \\\'none\\\'; img-src data: http: https: cid:; media-src data: http: https:; style-src \\\'unsafe-inline\\\'; font-src data: http: https:; frame-src http: https:; connect-src \\\'none\\\'; script-src \\\'none\\\'; base-uri \\\'none\\\'; form-action \\\'none\\\'\">',
        '<meta name=\"referrer\" content=\"no-referrer\">',
        '<base target=\"_blank\">',
        '<style>html,body{margin:0;padding:0;background:#fff;color:#111827}body{padding:16px;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}img{max-width:100%;height:auto}pre{white-space:pre-wrap;word-break:break-word}</style>',
        '</head>',
        '<body>',
        body,
        '</body>',
        '</html>',
      ].join('');
    };

    const renderSelectedHtml = (frameId, emailHtml) => {
      const frame = document.getElementById(frameId);
      if (frame) {
        frame.setAttribute('srcdoc', buildHtmlDocument(emailHtml));
      }
    };

    const clearRenderedHtml = () => {
      ['email-html-frame-desktop', 'email-html-frame-mobile'].forEach((frameId) => {
        const frame = document.getElementById(frameId);
        if (frame) frame.removeAttribute('srcdoc');
      });
    };

    const resetSelectedEmail = () => {
      state.emailLoadSeq += 1;
      state.selected = null;
      state.selectedId = null;
      state.selectedIsHtml = false;
      state.selectedPlainText = '';
      state.isEmailLoading = false;
      state.modalOpen = false;
      clearRenderedHtml();
    };

    const scheduleHtmlRender = () => {
      state.htmlRenderSeq += 1;
      const renderSeq = state.htmlRenderSeq;
      if (!state.selectedIsHtml || !state.selected) {
        clearRenderedHtml();
        return;
      }

      const selectedId = state.selected.id;
      const emailHtml = state.selected.body_html || '';
      clearRenderedHtml();
      setTimeout(() => {
        if (renderSeq !== state.htmlRenderSeq) return;
        if (!state.selectedIsHtml || !state.selected || state.selected.id !== selectedId) return;
        const frameId = state.isDesktopLayout ? 'email-html-frame-desktop' : 'email-html-frame-mobile';
        renderSelectedHtml(frameId, emailHtml);
      }, 0);
    };

    const syncViewportState = () => {
      state.isDesktopLayout = window.matchMedia('(min-width: 1024px)').matches;
      if (state.isDesktopLayout) {
        state.modalOpen = false;
      }
      scheduleHtmlRender();
    };

    const beginInboxLoad = async (preserveExisting = false) => {
      state.inboxLoadSeq += 1;
      const loadSeq = state.inboxLoadSeq;
      state.isInboxLoading = true;
      if (!preserveExisting) {
        state.emails = [];
        
      }
      return loadSeq;
    };

    const generateRandom = async () => {
      if (state.diceRolling) return;
      state.diceRolling = true;
      try {
        const selectedDom = state.selectedDomain || defaultMailDomain;
        const response = await fetch('/api/mailbox/random?domain=' + encodeURIComponent(selectedDom));
        const data = await response.json();
        if (!response.ok) throw new Error(getErrorMessage(data, 'Failed to generate random inbox.'));
        const [localPart = '', respDomain = ''] = String(data.mailbox || '').split('@');
        state.localPart = localPart;
        if (respDomain && state.availableDomains.includes(respDomain)) {
          state.selectedDomain = respDomain;
        }
      } catch (error) {
        state.status = error instanceof Error ? error.message : 'Failed to generate random inbox.';
      } finally {
        state.diceRolling = false;
      }
    };

    const checkGlobalAuth = async () => {
      if (!state.auth.enabled) return;
      state.auth.loading = true;
      try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        if (response.ok) {
          state.auth.hasOwner = data.hasOwner;
          state.auth.authenticated = data.authenticated;
        }
      } catch (error) {
        console.error('Auth status check failed', error);
      } finally {
        state.auth.loading = false;
      }
    };

    const handleRegisterOwner = async () => {
      state.auth.loading = true;
      try {
        const optionsResponse = await fetch('/api/auth/register/options', { method: 'POST' });
        const optionsData = await optionsResponse.json();
        if (!optionsResponse.ok) throw new Error(getErrorMessage(optionsData, 'Registration failed.'));

        const credential = await startRegistration({ optionsJSON: optionsData.options });
        const verifyResponse = await fetch('/api/auth/register/verify', {
          method: 'POST',
          body: JSON.stringify({ response: credential })
        });
        if (!verifyResponse.ok) {
           const verifyData = await verifyResponse.json();
           throw new Error(getErrorMessage(verifyData, 'Verification failed.'));
        }

        state.auth.hasOwner = true;
        state.auth.authenticated = true;
        generateRandom();
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Passkey registration failed.');
      } finally {
        state.auth.loading = false;
      }
    };

    const handleLoginOwner = async () => {
      state.auth.loading = true;
      try {
        const optionsResponse = await fetch('/api/auth/login/options', { method: 'POST' });
        const optionsData = await optionsResponse.json();
        if (!optionsResponse.ok) throw new Error(getErrorMessage(optionsData, 'Login failed.'));

        const credential = await startAuthentication({ optionsJSON: optionsData.options });
        const verifyResponse = await fetch('/api/auth/login/verify', {
          method: 'POST',
          body: JSON.stringify({ response: credential })
        });
        if (!verifyResponse.ok) {
           const verifyData = await verifyResponse.json();
           throw new Error(getErrorMessage(verifyData, 'Verification failed.'));
        }

        state.auth.authenticated = true;
        generateRandom();
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Passkey login failed.');
      } finally {
        state.auth.loading = false;
      }
    };

    const loadEmails = async (options = {}) => {
      const mailbox = typeof options?.mailbox === 'string' && options.mailbox
        ? options.mailbox
        : state.activeMailbox;

      if (!mailbox) return;
      if (state.auth.enabled && !state.auth.authenticated) return;
      
      const preserveExisting = Boolean(options && options.preserveExisting);
      const loadSeq = await beginInboxLoad(preserveExisting);
      try {
        const response = await fetch('/api/emails?to=' + encodeURIComponent(mailbox));
        const data = await response.json();
        if (!response.ok) throw new Error(getErrorMessage(data, 'Failed to load emails.'));
        if (loadSeq !== state.inboxLoadSeq || mailbox !== state.activeMailbox) return;
        state.emails = Array.isArray(data) ? data : [];
        if (state.selectedId) {
          const matchingEmail = state.emails.find((email) => email.id === state.selectedId);
          if (!matchingEmail) {
            resetSelectedEmail();
          }
        }
        
        if (mailbox !== state.activeMailbox) return;
        state.status = 'Monitoring: ' + mailbox + ' (real-time active)';
      } catch (error) {
        if (loadSeq !== state.inboxLoadSeq || mailbox !== state.activeMailbox) return;
        state.status = error instanceof Error ? error.message : 'Failed to load emails.';
      } finally {
        if (loadSeq === state.inboxLoadSeq && mailbox === state.activeMailbox) {
          state.isInboxLoading = false;
        }
      }
    };

    const closeSSE = () => {
      if (!state.eventSource) return;
      state.eventSource.close();
      state.eventSource = null;
    };

    const connectSSE = (mailbox) => {
      if (!mailbox) return;
      if (state.auth.enabled && !state.auth.authenticated) return;
      closeSSE();

      const eventSource = new EventSource('/api/stream?to=' + encodeURIComponent(mailbox));
      state.eventSource = eventSource;

      eventSource.addEventListener('ready', () => {
        if (state.eventSource !== eventSource || state.activeMailbox !== mailbox) return;
        state.status = 'Monitoring: ' + mailbox + ' (real-time active)';
      });

      eventSource.addEventListener('update', () => {
        if (state.eventSource !== eventSource || state.activeMailbox !== mailbox) return;
        loadEmails({ mailbox, preserveExisting: true });
      });

      eventSource.onerror = () => {
        if (state.eventSource !== eventSource) return;
        if (eventSource.readyState === EventSource.CLOSED) {
          closeSSE();
        }
        state.status = 'Realtime connection interrupted, reconnecting...';
      };
    };

    const activateInbox = async () => {
      const local = normalizeLocalPart(state.localPart);
      if (!local) {
        alert('Please input email name only (without @), e.g. john.doe');
        return;
      }

      const newMailbox = toMailbox(local);
      const isRefresh = state.showInbox && state.activeMailbox === newMailbox;

      closeSSE();
      state.localPart = local;
      state.activeMailbox = newMailbox;
      state.showInbox = true;
      
      if (!isRefresh) {
        resetSelectedEmail();
        state.emails = [];
      }
      
      state.status = isRefresh ? 'Refreshing inbox...' : 'Loading inbox...';
      loadEmails({ mailbox: newMailbox, preserveExisting: isRefresh });
      connectSSE(newMailbox);
    };

    const viewEmail = async (id) => {
      if (!state.activeMailbox) return;
      state.emailLoadSeq += 1;
      const loadSeq = state.emailLoadSeq;
      state.selectedId = id;
      state.modalOpen = !state.isDesktopLayout;
      state.isEmailLoading = true;
      state.selected = null;
      state.selectedIsHtml = false;
      state.selectedPlainText = '';
      clearRenderedHtml();

      try {
        const response = await fetch('/api/email/' + id + '?to=' + encodeURIComponent(state.activeMailbox));
        const email = await response.json();
        if (!response.ok) throw new Error(getErrorMessage(email, 'Failed to load email.'));
        if (loadSeq !== state.emailLoadSeq) return;

        state.selected = email;
        state.selectedId = email.id;
        state.selectedPlainText = getPlainTextBody(email);
        state.selectedIsHtml = hasMeaningfulHtml(email, state.selectedPlainText);
        scheduleHtmlRender();
      } catch (error) {
        if (loadSeq !== state.emailLoadSeq) return;
        state.modalOpen = false;
        state.selected = null;
        state.selectedId = null;
        state.selectedIsHtml = false;
        state.selectedPlainText = '';
        clearRenderedHtml();
        alert(error instanceof Error ? error.message : 'Failed to load email.');
      } finally {
        if (loadSeq === state.emailLoadSeq) {
          state.isEmailLoading = false;
        }
      }
    };

    const closeModal = () => {
      state.modalOpen = false;
      clearRenderedHtml();
    };

    watch(
      () => [state.selected?.id || '', state.selectedIsHtml, state.isDesktopLayout, state.modalOpen].join('|'),
      () => {
        scheduleHtmlRender();
      }
    );

    watch(
      () => [
        state.activeMailbox,
        state.isInboxLoading,
        state.selectedId,
        state.isEmailLoading,
        state.emails.length,
        state.emails.map((email) => [email.id, email.timestamp, email.subject, email.preview, email.id_from].join('::')).join('||')
      ].join('|'),
      () => {
        state.inboxBodyVersion += 1;
      }
    );

    const renderInboxSkeleton = () => html\`
      <div class="stack-sm">
        \${state.skeletonItems.map((n) => html\`
          <div class="email-item email-skeleton" aria-hidden="true">
            <div class="email-row">
              <div class="skeleton-line skeleton-subject"></div>
              <div class="skeleton-line skeleton-meta"></div>
            </div>
            <div class="skeleton-line skeleton-from"></div>
            <div class="skeleton-line skeleton-snippet"></div>
            <div class="skeleton-line skeleton-snippet short"></div>
          </div>
        \`.key('email-skeleton-' + n))}
      </div>
    \`;

    const renderInboxEmpty = (mailbox) => html\`
      <div class="empty-state empty-state-compact">
        <div class="empty-icon">✉️</div>
        <div class="empty-copy">
          <h3>Your inbox is empty</h3>
          <p>No emails have arrived at <b>\${mailbox}</b> yet. Share this address or wait a moment. The inbox refreshes automatically when new messages arrive.</p>
        </div>
      </div>
    \`;

    const renderInboxEmailItem = (email, selectedId, isEmailLoading) => {
      const classes = ['email-item'];
      if (selectedId === email.id) classes.push('is-active');
      if (isEmailLoading && selectedId === email.id) classes.push('is-loading');

      return html\`
        <div
          class="\${classes.join(' ')}"
          @click="\${() => viewEmail(email.id)}"
        >
          <div class="email-row">
            <div class="subject">\${email.subject || '(No Subject)'}</div>
            <span class="meta">\${formatTimestamp(email.timestamp)}</span>
          </div>
          <div class="meta">\${'From: ' + email.id_from}</div>
          <div class="snippet">\${previewText(email)}</div>
        </div>
      \`.key(email.id);
    };

    const renderInboxBody = () => {
      const activeMailbox = state.activeMailbox || '';
      const isInboxLoading = state.isInboxLoading;
      const selectedId = state.selectedId;
      const isEmailLoading = state.isEmailLoading;
      const emails = Array.isArray(state.emails) ? [...state.emails] : [];
      const inboxBodyKey = 'inbox-body-' + (activeMailbox || 'closed') + '-' + state.inboxBodyVersion;

      return html\`
        <div class=\"inbox-body-content\">\${() => {
          if (isInboxLoading && emails.length === 0) {
            return renderInboxSkeleton().key(inboxBodyKey + '-skeleton');
          }

          if (emails.length === 0) {
            return renderInboxEmpty(activeMailbox).key(inboxBodyKey + '-empty');
          }

          return html\`
            <div class=\"stack-sm\">
              \${emails.map((email) => renderInboxEmailItem(email, selectedId, isEmailLoading))}
            </div>
          \`.key(inboxBodyKey + '-list');
        }}</div>
      \`.key(inboxBodyKey);
    };

    const renderDesktopDetail = () => {
      if (!state.showInbox) {
        return html\`
          <div class=\"detail-stage detail-empty detail-welcome\">
            <div class=\"detail-empty-art detail-welcome-art\" aria-hidden=\"true\">
              <div class=\"empty-icon detail-empty-icon detail-welcome-icon\">💌</div>
              <div class=\"detail-empty-glow\"></div>
            </div>
            <div class=\"empty-copy detail-empty-copy\">
              <span class=\"detail-empty-kicker\">Disposable Inbox, Better Presented</span>
              <h3>Create a temporary mailbox and inspect emails in real time.</h3>
              <p>Hana Temp Mail gives you a fast disposable inbox for signups, OTP checks, transactional email testing, and quick verification flows, all inside a focused desktop workspace.</p>
            </div>
            <div class=\"detail-guide-grid detail-welcome-grid\">
              <article class=\"detail-guide-card\">
                <h4>Instant setup</h4>
                <p>Pick any mailbox name or roll a random one, then open the inbox in one click.</p>
              </article>
              <article class=\"detail-guide-card\">
                <h4>Live monitoring</h4>
                <p>Incoming messages appear automatically through realtime updates, so you can keep testing without manual refreshes.</p>
              </article>
              <article class=\"detail-guide-card\">
                <h4>Safe preview</h4>
                <p>Read plain text or sanitized HTML content with sender details and timestamps in a clean side-by-side layout.</p>
              </article>
            </div>
          </div>\`;
      }

      if (!state.selected && !state.isEmailLoading) {
        return html\`
          <div class=\"detail-stage detail-empty\">
            <div class=\"detail-empty-art\" aria-hidden=\"true\">
              <div class=\"empty-icon detail-empty-icon\">📭</div>
              <div class=\"detail-empty-glow\"></div>
            </div>
            <div class=\"empty-copy detail-empty-copy\">
              <span class=\"detail-empty-kicker\">Welcome to Hana Temp Mail</span>
              <h3>Your inbox is live. Pick any message to inspect it here.</h3>
              <p>This workspace is built for quick disposable inboxes. Create or reuse an address, keep the inbox open, and incoming emails will appear automatically without a full page refresh.</p>
            </div>
            <div class=\"detail-guide-grid\">
              <article class=\"detail-guide-card\">
                <h4>How it works</h4>
                <p>Choose a mailbox name, click <strong>Open Inbox</strong>, then share that address anywhere you need a temporary mailbox.</p>
              </article>
              <article class=\"detail-guide-card\">
                <h4>What you can do</h4>
                <p>Preview sender details, timestamps, plain text, and safe HTML email content from the message list on the left.</p>
              </article>
              <article class=\"detail-guide-card\">
                <h4>Best practice</h4>
                <p>Leave this inbox open while testing signups, OTP flows, and transactional emails so new messages show up in real time.</p>
              </article>
            </div>
          </div>\`;
      }

      if (state.isEmailLoading) {
        return html\`
          <div class=\"detail-stage modal-skeleton detail-loading\" aria-hidden=\"true\">
            <div class=\"skeleton-line skeleton-heading\"></div>
            <div class=\"skeleton-line skeleton-meta wide\"></div>
            <div class=\"skeleton-block\"></div>
            <div class=\"skeleton-line skeleton-snippet\"></div>
            <div class=\"skeleton-line skeleton-snippet short\"></div>
          </div>\`;
      }

      return html\`
        <div class=\"detail-stage detail-content\">
          <div class=\"detail-head\">
            <h2>\${() => state.selected?.subject || '(No Subject)'}</h2>
            <p class=\"meta\">\${() => state.selected ? ('From: ' + state.selected.id_from + ' | To: ' + state.selected.id_to) : ''}</p>
            <p class=\"meta\">\${() => state.selected ? formatTimestamp(state.selected.timestamp) : ''}</p>
          </div>
          <hr class=\"detail-divider\" />
          \${() => state.selectedIsHtml
            ? html\`<iframe id=\"email-html-frame-desktop\" class=\"email-html-frame\" sandbox=\"allow-popups\" referrerpolicy=\"no-referrer\"></iframe>\`
            : html\`<pre class=\"text-body\">\${() => state.selectedPlainText || '(No message body)'}</pre>\`}
        </div>\`;
    };

    const renderMobileDetail = () => {
      if (state.isEmailLoading) {
        return html\`
          <div class=\"modal-skeleton\" aria-hidden=\"true\">
            <div class=\"skeleton-line skeleton-heading\"></div>
            <div class=\"skeleton-line skeleton-meta wide\"></div>
            <div class=\"skeleton-block\"></div>
            <div class=\"skeleton-line skeleton-snippet\"></div>
            <div class=\"skeleton-line skeleton-snippet short\"></div>
          </div>\`;
      }

      if (state.selected && state.selectedIsHtml) {
        return html\`<iframe id=\"email-html-frame-mobile\" class=\"email-html-frame\" sandbox=\"allow-popups\" referrerpolicy=\"no-referrer\"></iframe>\`;
      }

      if (state.selected) {
        return html\`<pre class=\"text-body\">\${() => state.selectedPlainText || '(No message body)'}</pre>\`;
      }

      return '';
    };

    const renderAuthScreen = () => {
       if (state.auth.loading) {
         return html\`<div class=\"detail-empty\"><h3>Checking security...</h3></div>\`;
       }
       
       if (!state.auth.hasOwner) {
         return html\`
           <div class=\"detail-empty detail-welcome\">
             <div class=\"detail-empty-art\"><div class=\"empty-icon\">🔐</div></div>
             <div class=\"empty-copy\">
               <span class=\"detail-empty-kicker\">Secure Application</span>
               <h3>Setup Application Owner</h3>
               <p>This application is restricted. Please register your passkey to become the owner of this workspace.</p>
               <br/>
               <button @click=\"\${handleRegisterOwner}\">Create Owner Passkey</button>
             </div>
           </div>\`;
       }

       return html\`
         <div class=\"detail-empty detail-welcome\">
           <div class=\"detail-empty-art\"><div class=\"empty-icon\">🔑</div></div>
           <div class=\"empty-copy\">
             <span class=\"detail-empty-kicker\">Restricted Access</span>
             <h3>Owner Authentication Required</h3>
             <p>Please verify your identity to access the mailbox workspace.</p>
             <br/>
             <button @click=\"\${handleLoginOwner}\">Login with Passkey</button>
           </div>
         </div>\`;
    };

    const app = html\`
      \${() => (state.auth.enabled && !state.auth.authenticated) 
        ? renderAuthScreen() 
        : html\`
          <div class=\"hero\">
            <div class=\"hero-badge\">🌸 Hana Mail Workspace</div>
            <h1>Temporary Mail Inbox</h1>
            <p class=\"sub\">Generate a mailbox and monitor incoming messages in real time.</p>
          </div>

          <div class=\"page-main\">
            <aside class=\"sidebar\">
              <div class=\"card\">
                <div class=\"selector\">
                  <div class=\"input-wrap multi-domain\">
                    <input
                      type=\"text\"
                      placeholder=\"email name\"
                      .value=\"\${() => state.localPart}\"
                      @input=\"\${(event) => {
                        state.localPart = String(event.currentTarget?.value || '').toLowerCase();
                      }}\"
                    />
                    <div class=\"domain-select-wrap\">
                      <span class=\"domain-at\">@</span>
                      <select 
                        class=\"domain-select\"
                        @change=\"\${(e) => { state.selectedDomain = e.target.value; }}\"
                      >
                        \${() => state.availableDomains.map((d) => html\`
                          <option value="\${d}" .selected="\${d === state.selectedDomain}">\${d}</option>
                        \`)}
                      </select>
                    </div>
                    <button
                      class=\"\${() => state.diceRolling ? 'dice-btn is-rolling' : 'dice-btn'}\"
                      disabled=\"\${() => state.diceRolling || false}\"
                      @click=\"\${(event) => {
                        event.preventDefault();
                        generateRandom();
                      }}\"
                      title=\"Generate random inbox\"
                    >🎲</button>
                  </div>
                  <button style=\"display:block;width:100%;\" @click=\"\${() => activateInbox()}\">Open Inbox</button>
                </div>
                <div class=\"status\">\${() => state.status}</div>
              </div>

              \${() => state.showInbox ? html\`
                <div class=\"email-list-wrap card\" id=\"email-list\">
                  <div class=\"inbox-head\">
                    <span>Inbox: <b>\${() => state.activeMailbox}</b></span>
                    <span>\${() => state.emails.length + ' message(s)'}</span>
                  </div>
                  <div class=\"email-list-body\">\${() => renderInboxBody()}</div>
                </div>
              \` : ''}
            </aside>

            <section class=\"detail-panel\">\${() => renderDesktopDetail()}</section>
          </div>

          <div class=\"footer\">
            Built for Cloudflare Workers · <a href=\"https://github.com/ai-hana-ai/hana-temp-mail\" target=\"_blank\" rel=\"noopener noreferrer\">View source on GitHub</a>
          </div>

          <div
            class=\"\${() => state.modalOpen && !state.isDesktopLayout ? 'modal show' : 'modal'}\"
            @click=\"\${() => closeModal()}\"
          >
            <div class=\"modal-content\" @click=\"\${(event) => event.stopPropagation()}\">
              <h2>\${() => state.selected?.subject || '(No Subject)'}</h2>
              <p class=\"meta\">\${() => state.selected ? ('From: ' + state.selected.id_from + ' | To: ' + state.selected.id_to) : ''}</p>
              <hr class=\"detail-divider\" />
              \${() => renderMobileDetail()}
              <br />
              <button style=\"display:block;width:100%;\" @click=\"\${() => closeModal()}\">Close</button>
            </div>
          </div>
        \`}
    \`;

    app(root);
    syncViewportState();
    root.removeAttribute('data-cloak');

    const beforeUnloadHandler = () => closeSSE();
    const resizeHandler = () => syncViewportState();

    window.addEventListener('beforeunload', beforeUnloadHandler);
    window.addEventListener('resize', resizeHandler);

    if (state.auth.enabled) {
      checkGlobalAuth();
    } else {
      generateRandom();
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
    html {
      min-height: 100%;
      max-width: 100vw;
      overflow-x: hidden;
    }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      width: 100%;
      max-width: min(1440px, 100vw);
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
      overflow-x: hidden;
    }
    h1 { margin: 0; font-size: 1.85rem; letter-spacing: -0.02em; }
    p.sub { margin: 0.45rem 0 1rem; color: var(--muted); }
    .hero { margin-bottom: 1rem; text-align:center; }
    .hero-badge { display:inline-flex;align-items:center;gap:.4rem;background:rgba(109, 94, 252, .1);color:#4f46e5;border:1px solid rgba(109, 94, 252, .18);border-radius:999px;padding:.25rem .65rem;font-size:.75rem;font-weight:700;margin:0 auto .55rem; }
    .card { width:100%;max-width:100%;background:linear-gradient(180deg, #fff 0%, #fcfcff 100%);border:1px solid var(--line);border-radius:16px;padding:1rem;box-shadow:0 10px 26px rgba(23,34,74,.07),0 1px 0 rgba(255,255,255,.8) inset; }
    .selector { display:grid; gap:.7rem; }
    .input-wrap.multi-domain {
      display:grid;
      grid-template-columns:minmax(0, 1fr) auto auto;
      align-items:stretch;
      gap:0;
      border:1px solid #d8deea;
      border-radius:10px;
      background:#fff;
      overflow:hidden;
    }
    .input-wrap.multi-domain:focus-within {
      border-color:#b5c3ff;
      box-shadow:0 0 0 3px #eef1ff;
    }
    .input-wrap.multi-domain input {
      width:100%;
      min-width:0;
      border:none;
      background:transparent;
      padding:.82rem .9rem;
      font-size:.95rem;
      outline:none;
      text-transform:lowercase;
    }
    .domain-select-wrap {
      display:flex;
      align-items:center;
      gap:.1rem;
      padding:0 .75rem;
      border-left:none;
      background:transparent;
    }
    .domain-at { color:#7b8197; font-size:.92rem; font-weight:600; }
    .domain-select {
      border:none;
      background:transparent;
      color:#1f2937;
      font-weight:600;
      font-size:.92rem;
      outline:none;
      cursor:pointer;
      padding:.82rem 1.35rem .82rem .1rem;
      appearance:none;
      -webkit-appearance:none;
      background-image:
        linear-gradient(45deg, transparent 50%, #7b8197 50%),
        linear-gradient(135deg, #7b8197 50%, transparent 50%);
      background-position:
        calc(100% - 11px) calc(50% - 1px),
        calc(100% - 6px) calc(50% - 1px);
      background-size:5px 5px, 5px 5px;
      background-repeat:no-repeat;
    }
    input[type=\"text\"] { width:100%;padding:.72rem .78rem;border-radius:10px;border:1px solid #d8deea;font-size:.95rem;outline:none;text-transform:lowercase; }
    input[type=\"text\"]:focus { border-color:#b5c3ff; box-shadow:0 0 0 3px #eef1ff; }
    .dice-btn {
      position:relative;
      align-self:center;
      justify-self:center;
      margin-right:.45rem;
      border:none;
      background:transparent;
      color:#7b8197;
      box-shadow:none;
      cursor:pointer;
      font-size:1rem;
      line-height:1;
      width:2.2rem;
      height:2.2rem;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      border-radius:10px;
      padding:0;
    }
    .dice-btn:hover { background:rgba(0,0,0,.04); transform:none; }
    .dice-btn.is-rolling { animation:dice-spin 700ms linear infinite; }
    @keyframes dice-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    button { background:linear-gradient(135deg,var(--accent) 0%,var(--accent-2) 100%);color:#fff;border:none;padding:.72rem .95rem;border-radius:11px;cursor:pointer;font-weight:700;letter-spacing:.01em;box-shadow:0 8px 20px rgba(109, 94, 252, .28); }
    button:hover { filter:brightness(1.02);transform:translateY(-.5px); }
    .status {font-size:.87rem;color:var(--muted);margin-top:.3rem;background:#f8f9ff;border:1px dashed #dce2f7;border-radius:10px;padding:.45rem .6rem; }
    .sidebar { width:100%;max-width:100vw;display:flex; flex-direction:column; gap:1rem; min-height:0; min-width:0; overflow-x:hidden; }
    .email-list-wrap { margin-top:0; display:flex; flex-direction:column; flex:1 1 auto; min-height:0; min-width:0; max-width:100vw; overflow-x:hidden; }
    .email-list-body { flex:1 1 auto; min-height:0; overflow-y:auto; }
    .stack-sm { display:flex; flex-direction:column; gap:.65rem; min-height:0; }
    .page-main { width:100%;max-width:100vw;flex:1; display:grid; gap:1rem; min-height:0; min-width:0; overflow-x:hidden; }
    .detail-panel { display:none; }
    .detail-stage { min-height:100%; }
    .detail-content { min-height:100%; max-width:100%; overflow:hidden; }
    .detail-head h2 { margin:0 0 .35rem; font-size:1.35rem; letter-spacing:-.02em; word-break:break-word; overflow-wrap:anywhere; }
    .detail-empty {
      min-height:100%;
      display:flex;
      flex-direction:column;
      justify-content:center;
      align-items:center;
      text-align:center;
      gap:1.25rem;
      padding:2.8rem 1.5rem;
      background:
        radial-gradient(circle at top, rgba(139, 125, 255, .16) 0%, rgba(139, 125, 255, 0) 42%),
        linear-gradient(180deg, rgba(255,255,255,.88) 0%, rgba(244,247,255,.98) 100%);
      border:1px dashed #dce2f7;
      border-radius:18px;
      overflow:hidden;
    }
    .detail-welcome {
      background:
        radial-gradient(circle at top left, rgba(109, 94, 252, .18) 0%, rgba(109, 94, 252, 0) 36%),
        radial-gradient(circle at bottom right, rgba(79, 70, 229, .12) 0%, rgba(79, 70, 229, 0) 38%),
        linear-gradient(180deg, rgba(255,255,255,.94) 0%, rgba(243,246,255,.98) 100%);
      border-style:solid;
    }
    .detail-empty-art {
      position:relative;
      width:7rem;
      height:7rem;
      display:grid;
      place-items:center;
      flex-shrink:0;
    }
    .detail-empty-icon {
      width:5rem;
      height:5rem;
      font-size:2rem;
      border-radius:1.6rem;
      z-index:1;
    }
    .detail-empty-glow {
      position:absolute;
      inset:.55rem;
      border-radius:2rem;
      background:radial-gradient(circle, rgba(109, 94, 252, .18) 0%, rgba(109, 94, 252, .03) 55%, rgba(109, 94, 252, 0) 75%);
      filter:blur(4px);
    }
    .detail-empty-copy {
      max-width:26rem;
      display:grid;
      gap:.45rem;
    }
    .detail-welcome-grid {
      max-width:52rem;
    }
    .detail-welcome-art {
      width:8rem;
      height:8rem;
    }
    .detail-welcome-icon {
      width:5.5rem;
      height:5.5rem;
      font-size:2.3rem;
      border-radius:1.8rem;
      background:
        radial-gradient(circle at 30% 30%, #ffffff 0%, #f5f3ff 46%, #e4e9ff 100%);
    }
    .detail-empty-kicker {
      display:inline-flex;
      justify-content:center;
      align-items:center;
      width:max-content;
      margin:0 auto;
      padding:.32rem .7rem;
      border-radius:999px;
      background:rgba(109, 94, 252, .1);
      color:#5548d9;
      font-size:.76rem;
      font-weight:700;
      letter-spacing:.04em;
      text-transform:uppercase;
    }
    .detail-empty-copy h3 {
      margin:0;
      font-size:1.28rem;
      letter-spacing:-.02em;
    }
    .detail-empty-copy p {
      margin:0;
      font-size:.97rem;
      color:#5b6477;
    }
    .detail-guide-grid {
      width:100%;
      max-width:48rem;
      display:grid;
      grid-template-columns:repeat(auto-fit, minmax(13rem, 1fr));
      gap:.9rem;
    }
    .detail-guide-card {
      text-align:left;
      padding:1rem 1rem 1.05rem;
      border-radius:16px;
      border:1px solid rgba(210, 217, 242, .95);
      background:rgba(255, 255, 255, .82);
      box-shadow:0 10px 24px rgba(109,94,252,.06);
      backdrop-filter:blur(8px);
    }
    .detail-guide-card h4 {
      margin:0 0 .38rem;
      font-size:.98rem;
      letter-spacing:-.01em;
    }
    .detail-guide-card p {
      margin:0;
      color:#5b6477;
      font-size:.9rem;
    }
    .detail-loading { min-height:100%; }
    .detail-divider { border:0; border-top:1px solid #e9ecf7; margin:1rem 0; }
    .inbox-head { display:flex;justify-content:space-between;align-items:center;margin-bottom:.65rem;color:var(--muted);font-size:.9rem; }
    .email-item {
      display:flex;
      flex-direction:column;
      align-items:stretch;
      gap:.35rem;
      min-width:0;
      max-width:100%;
      background:linear-gradient(180deg,#fff 0%,#fdfdff 100%);
      padding:.95rem 1rem;
      border-radius:13px;
      border:1px solid #dfe4f4;
      cursor:pointer;
      transition:border-color .16s ease, box-shadow .16s ease, background .16s ease;
    }
    .email-item:hover { border-color:#c9d0ff;box-shadow:0 10px 24px rgba(79,70,229,.11); }
    .email-item.is-active {
      border-color:#98a3ff;
      background:linear-gradient(180deg, #f7f8ff 0%, #eef1ff 100%);
      box-shadow:0 14px 30px rgba(79,70,229,.14);
    }
    .email-item.is-loading {
      cursor:progress;
    }
    .email-row { display:flex;justify-content:space-between;gap:.75rem;align-items:center;min-width:0; }
    .email-row > * { min-width:0; }
    .subject {
      min-width:0;
      flex:1 1 auto;
      font-weight:600;
      color:var(--text);
      overflow:hidden;
      white-space:nowrap;
      text-overflow:ellipsis;
    }
    .email-item .meta {
      display:block;
      min-width:0;
      white-space:normal;
      word-break:break-word;
    }
    .meta { font-size:.82rem; color:var(--muted); }
    .snippet {
      display:block;
      width:100%;
      min-width:0;
      margin-top:.1rem;
      color:#4b5563;
      font-size:.88rem;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
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
    .empty-state-compact {
      padding:1.3rem 1rem;
      box-shadow:none;
      border-style:dashed;
    }
    .email-skeleton { cursor:default; pointer-events:none; }
    .email-skeleton:hover { border-color:var(--line); box-shadow:none; transform:none; }
    .skeleton-line,\n    .skeleton-block {
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
    .email-html-frame {
      width:100%;
      min-height:420px;
      border:1px solid #e5e7eb;
      border-radius:10px;
      background:#fff;
    }
    .modal { position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;justify-content:center;align-items:center;padding:1rem; }
    .modal.show { display:flex; }
    .modal-content {
      width:780px;
      max-width:100%;
      max-height:90%;
      overflow:auto;
      background:#fff;
      border-radius:14px;
      border:1px solid var(--line);
      padding:1.1rem;
    }
    .modal-content h2,
    .modal-content .meta,
    .detail-content .meta {
      word-break:break-word;
      overflow-wrap:anywhere;
    }
    .text-body {
      max-width:100%;
      overflow-x:auto;
      white-space:pre-wrap;
      word-break:break-word;
      background:#fafbff;
      border:1px solid var(--line);
      border-radius:10px;
      padding:.85rem;
      line-height:1.5;
    }
    .footer { margin-top:1.1rem;text-align:center;color:var(--muted);font-size:.84rem;padding-top:.65rem;border-top:1px solid #e8ebf7; }
    .footer a { color: var(--accent); text-decoration:none; font-weight:600; }
    .footer a:hover { text-decoration:underline; }
    @media (max-width: 1023.98px) {
      body {
        padding: 1rem .75rem;
      }
    }
    @media (min-width: 1024px) {
      html, body { height:100%; }
      body {
        padding:1.5rem;
        height:100dvh;
        max-height:100dvh;
        overflow:hidden;
        display:grid;
        grid-template-rows:auto minmax(0, 1fr) auto;
        gap:1.25rem;
      }
      .hero { text-align:left; margin-bottom:0; }
      .hero-badge { margin:0 0 .55rem; }
      .page-main {
        grid-template-columns:minmax(360px, 390px) minmax(0, 1fr);
        align-items:stretch;
        min-height:0;
        height:100%;
        overflow:hidden;
      }
      .sidebar {
        flex:1 1 auto;
        min-height:0;
        overflow:hidden;
      }
      .email-list-wrap {
        min-height:0;
        flex:1 1 auto;
        overflow:hidden;
      }
      .email-list-body {
        min-height:0;
        flex:1 1 auto;
        overflow-y:auto;
        overscroll-behavior:contain;
        padding-right:.25rem;
      }
      .detail-panel {
        display:block;
        min-height:0;
        height:100%;
        overflow:hidden;
      }
      .detail-stage {
        height:100%;
        min-height:0;
      }
      .detail-content,
      .detail-loading,
      .detail-empty {
        min-height:100%;
        height:100%;
      }
      .detail-content {
        display:grid;
        grid-template-rows:auto auto minmax(0, 1fr);
      }
      .detail-loading {
        overflow:auto;
      }
      .text-body {
        min-height:0;
        height:100%;
        overflow:auto;
      }
      .email-html-frame {
        min-height:0;
        height:100%;
      }
      .modal { display:none !important; }
    }
  `;

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
        />
        <style dangerouslySetInnerHTML={{ __html: '#app[data-cloak] { display: none !important; }' }} />
        <title>Temporary Mail Inbox</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <div id="app" data-cloak data-mail-domain={`@${mailDomain}`}></div>
        <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
      </body>
    </html>
  );
}

export function renderHomePage(
  mailDomain: string,
  mailDomainsOrOptions: string[] | { passkeyEnabled?: boolean } = {},
  maybeOptions: { passkeyEnabled?: boolean } = {}
) {
  const mailDomains = Array.isArray(mailDomainsOrOptions)
    ? (mailDomainsOrOptions.length > 0 ? mailDomainsOrOptions : [mailDomain])
    : [mailDomain];
  const options = Array.isArray(mailDomainsOrOptions) ? maybeOptions : mailDomainsOrOptions;

  return '<!DOCTYPE html>' + (
    <HomePage
      mailDomain={mailDomain}
      mailDomains={mailDomains}
      passkeyEnabled={options.passkeyEnabled}
    />
  );
}
