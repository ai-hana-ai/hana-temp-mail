import { html, reactive, watch } from 'https://esm.sh/@arrow-js/core';
import { 
  startRegistration, 
  startAuthentication 
} from 'https://esm.sh/@simplewebauthn/browser';

export function initApp(config: any) {
    const { mailDomain, availableMailDomains, passkeyEnabled, mailboxLocalPartRegexSource } = config;
    const mailboxLocalPartPattern = new RegExp(mailboxLocalPartRegexSource);
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
      activateInboxSeq: 0,
      inboxLoadSeq: 0,
      emailLoadSeq: 0,
      htmlRenderSeq: 0,
      inboxFetchController: null,
      
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

    const isCurrentInboxRun = (mailbox, activateInboxSeq) => {
      if (typeof activateInboxSeq === 'number' && activateInboxSeq !== state.activateInboxSeq) return false;
      if (mailbox && state.activeMailbox && mailbox !== state.activeMailbox) return false;
      return true;
    };

    const updateInboxStatus = (message, mailbox, activateInboxSeq) => {
      if (!isCurrentInboxRun(mailbox, activateInboxSeq)) return;
      state.status = message;
    };

    const normalizeLocalPart = (value) => {
      const normalized = (value || '').trim().toLowerCase();
      if (!normalized) return null;
      if (!mailboxLocalPartPattern.test(normalized)) return null;
      return normalized;
    };

    const toMailbox = (localPart, domain = state.selectedDomain || defaultMailDomain) => localPart + '@' + domain;

    const normalizeMailboxSelection = (value) => {
      const normalized = (value || '').trim().toLowerCase();
      if (!normalized) return null;

      if (!normalized.includes('@')) {
        const localPart = normalizeLocalPart(normalized);
        if (!localPart) return null;
        const domain = state.selectedDomain || defaultMailDomain;
        return {
          localPart,
          domain,
          mailbox: toMailbox(localPart, domain),
        };
      }

      const parts = normalized.split('@');
      if (parts.length !== 2) return null;

      const [rawLocalPart, rawDomain] = parts;
      const localPart = normalizeLocalPart(rawLocalPart);
      const domain = (rawDomain || '').trim().toLowerCase();
      if (!localPart || !domain || !state.availableDomains.includes(domain)) return null;

      return {
        localPart,
        domain,
        mailbox: toMailbox(localPart, domain),
      };
    };

    const normalizeSqliteTs = (ts) => {
      if (!ts) return '';
      if (typeof ts !== 'string') return ts;
      if (/Z$|[+-]\d\d:\d\d$/.test(ts)) return ts;
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(ts)) {
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
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
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
        .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
        .replace(/\s+/g, ' ')
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

          if (name === 'style' && /expression|url\s*\(/i.test(value)) {
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
        '<meta http-equiv=\"Content-Security-Policy\" content=\"default-src \'none\'; img-src data: http: https: cid:; media-src data: http: https:; style-src \'unsafe-inline\'; font-src data: http: https:; frame-src http: https:; connect-src \'none\'; script-src \'none\'; base-uri \'none\'; form-action \'none\'\">',
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

    const beginInboxLoad = (preserveExisting = false) => {
      state.inboxLoadSeq += 1;
      const loadSeq = state.inboxLoadSeq;
      state.isInboxLoading = true;
      if (!preserveExisting) {
        resetSelectedEmail();
        state.emails = [];
      }
      return loadSeq;
    };

    const cancelInboxLoad = () => {
      if (!state.inboxFetchController) return;
      state.inboxFetchController.abort();
      state.inboxFetchController = null;
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
      const activateInboxSeq = typeof options?.activateInboxSeq === 'number'
        ? options.activateInboxSeq
        : state.activateInboxSeq;

      if (!mailbox) {
        state.isInboxLoading = false;
        return;
      }
      if (state.auth.enabled && !state.auth.authenticated) {
        state.isInboxLoading = false;
        updateInboxStatus('Authentication required before loading ' + mailbox + '.', mailbox, activateInboxSeq);
        return;
      }

      const preserveExisting = Boolean(options?.preserveExisting);
      cancelInboxLoad();
      const loadSeq = beginInboxLoad(preserveExisting);
      const controller = new AbortController();
      let didTimeout = false;
      const timeoutId = window.setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, 12000);
      state.inboxFetchController = controller;
      try {
        updateInboxStatus(
          preserveExisting
            ? 'Refreshing messages for ' + mailbox + '...'
            : 'Loading inbox history for ' + mailbox + '...',
          mailbox,
          activateInboxSeq
        );
        const response = await fetch('/api/emails?to=' + encodeURIComponent(mailbox), {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getErrorMessage(data, 'Failed to load emails.'));
        if (loadSeq !== state.inboxLoadSeq || !isCurrentInboxRun(mailbox, activateInboxSeq)) return;
        state.emails = Array.isArray(data) ? data : [];
        if (state.selectedId) {
          const matchingEmail = state.emails.find((email) => email.id === state.selectedId);
          if (!matchingEmail) {
            resetSelectedEmail();
          }
        }

        updateInboxStatus(
          state.emails.length > 0
            ? 'Inbox ready for ' + mailbox + ' (' + state.emails.length + ' message(s)).'
            : 'Inbox ready for ' + mailbox + '. Waiting for the first email...',
          mailbox,
          activateInboxSeq
        );
      } catch (error) {
        if (loadSeq !== state.inboxLoadSeq || !isCurrentInboxRun(mailbox, activateInboxSeq)) return;

        const message = controller.signal.aborted
          ? (didTimeout
            ? 'Loading ' + mailbox + ' took too long. Please retry.'
            : 'Loading ' + mailbox + ' was canceled.')
          : (error instanceof Error ? error.message : 'Failed to load emails.');

        if (message !== 'Loading ' + mailbox + ' was canceled.') {
          updateInboxStatus(message, mailbox, activateInboxSeq);
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
        if (state.inboxFetchController === controller) {
          state.inboxFetchController = null;
        }
        if (loadSeq === state.inboxLoadSeq) {
          state.isInboxLoading = false;
        }
      }
    };

    const closeSSE = () => {
      if (!state.eventSource) return;
      state.eventSource.close();
      state.eventSource = null;
    };

    const connectSSE = (mailbox, activateInboxSeq) => {
      if (!mailbox) return;
      if (state.auth.enabled && !state.auth.authenticated) {
        updateInboxStatus('Authentication required before realtime monitoring starts.', mailbox, activateInboxSeq);
        return;
      }
      closeSSE();

      const eventSource = new EventSource('/api/stream?to=' + encodeURIComponent(mailbox));
      state.eventSource = eventSource;

      eventSource.addEventListener('ready', () => {
        if (state.eventSource !== eventSource || !isCurrentInboxRun(mailbox, activateInboxSeq)) return;
        updateInboxStatus('Realtime connected for ' + mailbox + '. Monitoring incoming mail...', mailbox, activateInboxSeq);
      });

      eventSource.addEventListener('update', () => {
        if (state.eventSource !== eventSource || !isCurrentInboxRun(mailbox, activateInboxSeq)) return;
        updateInboxStatus('New activity detected for ' + mailbox + '. Syncing inbox...', mailbox, activateInboxSeq);
        void loadEmails({ mailbox, preserveExisting: true, activateInboxSeq }).catch((error) => {
          if (!isCurrentInboxRun(mailbox, activateInboxSeq)) return;
          console.error('loadEmails from realtime update failed', error);
        });
      });

      eventSource.onerror = () => {
        if (state.eventSource !== eventSource) return;
        if (eventSource.readyState === EventSource.CLOSED) {
          closeSSE();
        }
        updateInboxStatus('Realtime connection interrupted for ' + mailbox + ', reconnecting...', mailbox, activateInboxSeq);
      };
    };

    const activateInbox = async () => {
      try {
        const inputEl = document.getElementById('mailbox-local-part-input') as HTMLInputElement;
        const input = (inputEl?.value || state.localPart || '').trim();
        state.localPart = input;

        const mailboxSelection = normalizeMailboxSelection(input);
        if (!mailboxSelection) {
          state.status = 'Enter an email name or a full mailbox for one of the configured domains.';
          alert('Please input an email name or full mailbox for a configured domain, e.g. john.doe or john.doe@adopsee.com');
          return;
        }

        const { localPart, domain, mailbox: newMailbox } = mailboxSelection;
        const isRefresh = state.showInbox && state.activeMailbox === newMailbox;
        const activateInboxSeq = state.activateInboxSeq + 1;
        state.activateInboxSeq = activateInboxSeq;

        // Only update input field if it was a valid mailbox selection and not already full
        if (!input.includes('@') && localPart) {
          state.localPart = localPart;
        }
        state.selectedDomain = domain;
        closeSSE();
        cancelInboxLoad();
        updateInboxStatus(
          isRefresh
            ? 'Refreshing workspace for ' + newMailbox + '...'
            : 'Preparing inbox workspace for ' + newMailbox + '...',
          undefined,
          activateInboxSeq
        );
        if (!isRefresh) {
          resetSelectedEmail();
          state.emails = [];
        }

        state.activeMailbox = newMailbox;
        state.showInbox = true;
        updateInboxStatus(
          isRefresh
            ? 'Reusing inbox view for ' + newMailbox + '...'
            : 'Switching inbox view to ' + newMailbox + '...',
          newMailbox,
          activateInboxSeq
        );
        await waitForPaint();

        updateInboxStatus('Opening realtime stream for ' + newMailbox + '...', newMailbox, activateInboxSeq);
        connectSSE(newMailbox, activateInboxSeq);

        void loadEmails({
          mailbox: newMailbox,
          preserveExisting: isRefresh,
          activateInboxSeq,
        }).catch((error) => {
          if (!isCurrentInboxRun(newMailbox, activateInboxSeq)) return;
          console.error('activateInbox loadEmails failed', error);
        });
      } catch (error) {
        closeSSE();
        cancelInboxLoad();
        state.status = error instanceof Error ? error.message : 'Failed to open inbox.';
        console.error('activateInbox failed', error);
      }
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

    const renderInboxEmpty = () => html`
      <div class="empty-state empty-state-compact">
        <div class="empty-icon">✉️</div>
        <div class="empty-copy">
          <h3>Your inbox is empty</h3>
          <p>No emails have arrived at <b>${() => state.activeMailbox || ''}</b> yet. Share this address or wait a moment. The inbox refreshes automatically when new messages arrive.</p>
        </div>
      </div>
    `;

    const renderInboxEmailItem = (email) => {
      return html`
        <div
          class="${() => {
            const classes = ['email-item'];
            if (state.selectedId === email.id) classes.push('is-active');
            if (state.isEmailLoading && state.selectedId === email.id) classes.push('is-loading');
            return classes.join(' ');
          }}"
          @click="${() => viewEmail(email.id)}"
        >
          <div class="email-row">
            <div class="subject">${email.subject || '(No Subject)'}</div>
            <span class="meta">${formatTimestamp(email.timestamp)}</span>
          </div>
          <div class="meta">${'From: ' + email.id_from}</div>
          <div class="snippet">${previewText(email)}</div>
        </div>
      `.key(email.id);
    };

    const renderInboxList = () => html`
      <div class="stack-sm">
        ${() => state.emails.map((email) => renderInboxEmailItem(email))}
      </div>
    `;

    const renderInboxBody = () => html`
      <div class="inbox-body-content" .key="${() => 'inbox-body-' + (state.activeMailbox || 'closed') + '-' + state.activateInboxSeq}">${() => {
        if (state.isInboxLoading && state.emails.length === 0) {
          return html`
            <div class="stack-sm">
              ${state.skeletonItems.map((n) => html`
                <div class="email-item email-skeleton" aria-hidden="true">
                  <div class="email-row">
                    <div class="skeleton-line skeleton-subject"></div>
                    <div class="skeleton-line skeleton-meta"></div>
                  </div>
                  <div class="skeleton-line skeleton-from"></div>
                  <div class="skeleton-line skeleton-snippet"></div>
                  <div class="skeleton-line skeleton-snippet short"></div>
                </div>
              `.key('email-skeleton-' + n))}
            </div>
          `;
        }

        if (state.emails.length === 0) {
          return renderInboxEmpty().key('inbox-body-' + (state.activeMailbox || 'closed') + '-empty');
        }

        return renderInboxList().key('inbox-body-' + (state.activeMailbox || 'closed') + '-list');
      }}</div>
    `;

    const renderDesktopDetail = () => {
      if (!state.showInbox) {
        return html`
          <div class="detail-stage detail-empty detail-welcome">
            <div class="detail-empty-art detail-welcome-art" aria-hidden="true">
              <div class="empty-icon detail-empty-icon detail-welcome-icon">💌</div>
              <div class="detail-empty-glow"></div>
            </div>
            <div class="empty-copy detail-empty-copy">
              <span class="detail-empty-kicker">Disposable Inbox, Better Presented</span>
              <h3>Create a temporary mailbox and inspect emails in real time.</h3>
              <p>Hana Temp Mail gives you a fast disposable inbox for signups, OTP checks, transactional email testing, and quick verification flows, all inside a focused desktop workspace.</p>
            </div>
            <div class="detail-guide-grid detail-welcome-grid">
              <article class="detail-guide-card">
                <h4>Instant setup</h4>
                <p>Pick any mailbox name or roll a random one, then open the inbox in one click.</p>
              </article>
              <article class="detail-guide-card">
                <h4>Live monitoring</h4>
                <p>Incoming messages appear automatically through realtime updates, so you can keep testing without manual refreshes.</p>
              </article>
              <article class="detail-guide-card">
                <h4>Safe preview</h4>
                <p>Read plain text or sanitized HTML content with sender details and timestamps in a clean side-by-side layout.</p>
              </article>
            </div>
          </div>`;
      }

      if (!state.selected && !state.isEmailLoading) {
        return html`
          <div class="detail-stage detail-empty">
            <div class="detail-empty-art" aria-hidden="true">
              <div class="empty-icon detail-empty-icon">📭</div>
              <div class="detail-empty-glow"></div>
            </div>
            <div class="empty-copy detail-empty-copy">
              <span class="detail-empty-kicker">Welcome to Hana Temp Mail</span>
              <h3>Your inbox is live. Pick any message to inspect it here.</h3>
              <p>This workspace is built for quick disposable inboxes. Create or reuse an address, keep the inbox open, and incoming emails will appear automatically without a full page refresh.</p>
            </div>
            <div class="detail-guide-grid">
              <article class="detail-guide-card">
                <h4>How it works</h4>
                <p>Choose a mailbox name, click <strong>Open Inbox</strong>, then share that address anywhere you need a temporary mailbox.</p>
              </article>
              <article class="detail-guide-card">
                <h4>What you can do</h4>
                <p>Preview sender details, timestamps, plain text, and safe HTML email content from the message list on the left.</p>
              </article>
              <article class="detail-guide-card">
                <h4>Best practice</h4>
                <p>Leave this inbox open while testing signups, OTP flows, and transactional emails so new messages show up in real time.</p>
              </article>
            </div>
          </div>`;
      }

      if (state.isEmailLoading) {
        return html`
          <div class="detail-stage modal-skeleton detail-loading" aria-hidden="true">
            <div class="skeleton-line skeleton-heading"></div>
            <div class="skeleton-line skeleton-meta wide"></div>
            <div class="skeleton-block"></div>
            <div class="skeleton-line skeleton-snippet"></div>
            <div class="skeleton-line skeleton-snippet short"></div>
          </div>`;
      }

      return html`
        <div class="detail-stage detail-content">
          <div class="detail-head">
            <h2>${() => state.selected?.subject || '(No Subject)'}</h2>
            <p class="meta">${() => state.selected ? ('From: ' + state.selected.id_from + ' | To: ' + state.selected.id_to) : ''}</p>
            <p class="meta">${() => state.selected ? formatTimestamp(state.selected.timestamp) : ''}</p>
          </div>
          <hr class="detail-divider" />
          ${() => state.selectedIsHtml
            ? html`<iframe id="email-html-frame-desktop" class="email-html-frame" sandbox="allow-popups" referrerpolicy="no-referrer"></iframe>`
            : html`<pre class="text-body">${() => state.selectedPlainText || '(No message body)'}</pre>`}
        </div>`;
    };

    const renderMobileDetail = () => {
      if (state.isEmailLoading) {
        return html`
          <div class="modal-skeleton" aria-hidden="true">
            <div class="skeleton-line skeleton-heading"></div>
            <div class="skeleton-line skeleton-meta wide"></div>
            <div class="skeleton-block"></div>
            <div class="skeleton-line skeleton-snippet"></div>
            <div class="skeleton-line skeleton-snippet short"></div>
          </div>`;
      }

      if (state.selected && state.selectedIsHtml) {
        return html`<iframe id="email-html-frame-mobile" class="email-html-frame" sandbox="allow-popups" referrerpolicy="no-referrer"></iframe>`;
      }

      if (state.selected) {
        return html`<pre class="text-body">${() => state.selectedPlainText || '(No message body)'}</pre>`;
      }

      return '';
    };

    const renderAuthScreen = () => {
       if (state.auth.loading) {
         return html`<div class="detail-empty"><h3>Checking security...</h3></div>`;
       }
       
       if (!state.auth.hasOwner) {
         return html`
           <div class="detail-empty detail-welcome">
             <div class="detail-empty-art"><div class="empty-icon">🔐</div></div>
             <div class="empty-copy">
               <span class="detail-empty-kicker">Secure Application</span>
               <h3>Setup Application Owner</h3>
               <p>This application is restricted. Please register your passkey to become the owner of this workspace.</p>
               <br/>
               <button @click="${handleRegisterOwner}">Create Owner Passkey</button>
             </div>
           </div>`;
       }

       return html`
         <div class="detail-empty detail-welcome">
           <div class="detail-empty-art"><div class="empty-icon">🔑</div></div>
           <div class="empty-copy">
             <span class="detail-empty-kicker">Restricted Access</span>
             <h3>Owner Authentication Required</h3>
             <p>Please verify your identity to access the mailbox workspace.</p>
             <br/>
             <button @click="${handleLoginOwner}">Login with Passkey</button>
           </div>
         </div>`;
    };

    const app = html`
      ${() => (state.auth.enabled && !state.auth.authenticated) 
        ? renderAuthScreen() 
        : html`
          <div class="hero">
            <div class="hero-badge">🌸 Hana Mail Workspace</div>
            <h1>Temporary Mail Inbox</h1>
            <p class="sub">Generate a mailbox and monitor incoming messages in real time.</p>
          </div>

          <div class="page-main">
            <aside class="sidebar">
              <div class="card">
                <div class="selector">
                  <div class="input-wrap multi-domain">
                    <input
                      id="mailbox-local-part-input"
                      type="text"
                      placeholder="email name"
                      value="${state.localPart}"
                      @input="${(e: any) => { state.localPart = e.target.value; }}"
                    />
                    <div class="domain-select-wrap">
                      <span class="domain-at">@</span>
                      <select 
                        class="domain-select"
                        .value="${() => state.selectedDomain}"
                        @change="${(e) => { state.selectedDomain = (e.target as HTMLSelectElement).value; }}"
                      >
                        ${() => state.availableDomains.map((d) => html`
                          <option value="${d}">${d}</option>
                        `)}
                      </select>
                    </div>
                    <button
                      class="${() => state.diceRolling ? 'dice-btn is-rolling' : 'dice-btn'}"
                      ?disabled="${() => state.diceRolling}"
                      @click="${(event) => {
                        event.preventDefault();
                        generateRandom();
                      }}"
                      title="Generate random inbox"
                    >🎲</button>
                  </div>
                  <button style="display:block;width:100%;" @click="${() => activateInbox()}">Open Inbox</button>
                </div>
                <div class="status">${() => state.status}</div>
              </div>

              ${() => state.showInbox ? html`
                <div class="email-list-wrap card" id="email-list">
                  <div class="inbox-head">
                    <span>Inbox: <b>${() => state.activeMailbox}</b></span>
                    <span>${() => state.emails.length + ' message(s)'}</span>
                  </div>
                  <div class="email-list-body">${() => renderInboxBody()}</div>
                </div>
              ` : ''}
            </aside>

            <section class="detail-panel">${() => renderDesktopDetail()}</section>
          </div>

          <div class="footer">
            Built for Cloudflare Workers · <a href="https://github.com/ai-hana-ai/hana-temp-mail" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
          </div>

          <div
            class="${() => state.modalOpen && !state.isDesktopLayout ? 'modal show' : 'modal'}"
            @click="${() => closeModal()}"
          >
            <div class="modal-content" @click="${(event) => event.stopPropagation()}">
              <h2>${() => state.selected?.subject || '(No Subject)'}</h2>
              <p class="meta">${() => state.selected ? ('From: ' + state.selected.id_from + ' | To: ' + state.selected.id_to) : ''}</p>
              <hr class="detail-divider" />
              ${() => renderMobileDetail()}
              <br />
              <button style="display:block;width:100%;" @click="${() => closeModal()}">Close</button>
            </div>
          </div>
        `}
    `;

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
}
