import { html, reactive } from 'https://esm.sh/@arrow-js/core';
import {
  startAuthentication,
  startRegistration,
} from 'https://esm.sh/@simplewebauthn/browser';

type AppConfig = {
  mailDomain: string;
  availableMailDomains: string[];
  passkeyEnabled: boolean;
  mailboxLocalPartRegexSource: string;
};

type EmailSummary = {
  id: string;
  id_from: string;
  subject: string;
  timestamp: string;
  preview: string;
};

type EmailDetail = EmailSummary & {
  body_text?: string;
  body_html?: string;
};

type MailboxParts = {
  local: string;
  domain: string;
  mailbox: string;
};

type AuthState = {
  enabled: boolean;
  hasOwner: boolean;
  authenticated: boolean;
  loading: boolean;
};

type LoadMode = 'replace' | 'refresh';

function createAuthState(enabled: boolean): AuthState {
  return {
    enabled,
    hasOwner: false,
    authenticated: !enabled,
    loading: enabled,
  };
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }
  return fallback;
}

export function initApp(config: AppConfig) {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing app root');

  const availableDomains = config.availableMailDomains.length > 0
    ? config.availableMailDomains
    : [config.mailDomain];
  const mailboxLocalPartPattern = new RegExp(config.mailboxLocalPartRegexSource);
  const desktopMediaQuery = window.matchMedia('(min-width: 1024px)');

  const state = reactive({
    draftLocalPart: '',
    selectedDomain: availableDomains[0] || config.mailDomain,
    availableDomains,
    status: 'Ready.',
    showInbox: false,
    activeMailbox: '',
    activeLocalPart: '',
    activeDomain: '',
    emails: [] as EmailSummary[],
    selectedEmailId: '',
    selectedEmail: null as EmailDetail | null,
    selectedEmailHtml: '',
    isSwitchingMailbox: false,
    isRefreshingInbox: false,
    isLoadingEmail: false,
    diceRolling: false,
    modalOpen: false,
    isDesktop: desktopMediaQuery.matches,
    auth: createAuthState(config.passkeyEnabled),
  });

  const runtime = {
    mailboxSessionId: 0,
    inboxRequestId: 0,
    emailRequestId: 0,
    stream: null as EventSource | null,
    inboxController: null as AbortController | null,
    emailController: null as AbortController | null,
  };

  const setStatus = (message: string) => {
    state.status = message;
  };

  const normalizeDraftInput = (value: string) => value.trim().toLowerCase();

  const isCurrentMailboxSession = (sessionId: number, mailbox: string) =>
    sessionId === runtime.mailboxSessionId && state.activeMailbox === mailbox;

  const abortInboxRequest = () => {
    if (!runtime.inboxController) return;
    runtime.inboxController.abort();
    runtime.inboxController = null;
  };

  const abortEmailRequest = () => {
    if (!runtime.emailController) return;
    runtime.emailController.abort();
    runtime.emailController = null;
  };

  const closeStream = () => {
    if (!runtime.stream) return;
    runtime.stream.close();
    runtime.stream = null;
  };

  const stopMailboxEffects = () => {
    closeStream();
    abortInboxRequest();
    abortEmailRequest();
  };

  const resetEmailSelection = () => {
    state.selectedEmailId = '';
    state.selectedEmail = null;
    state.selectedEmailHtml = '';
    state.isLoadingEmail = false;
    state.modalOpen = false;
  };

  const syncDraftFromMailbox = (parts: MailboxParts) => {
    state.draftLocalPart = parts.local;
    state.selectedDomain = parts.domain;
  };

  const parseMailboxInput = (value: string, fallbackDomain: string): MailboxParts | null => {
    const normalized = normalizeDraftInput(value);
    if (!normalized) return null;

    if (normalized.includes('@')) {
      const segments = normalized.split('@');
      if (segments.length !== 2) return null;

      const [local, domain] = segments;
      if (!mailboxLocalPartPattern.test(local)) return null;
      if (!availableDomains.includes(domain)) return null;

      return { local, domain, mailbox: `${local}@${domain}` };
    }

    if (!mailboxLocalPartPattern.test(normalized)) return null;

    return {
      local: normalized,
      domain: fallbackDomain,
      mailbox: `${normalized}@${fallbackDomain}`,
    };
  };

  const sanitizeHtmlEmail = (rawHtml: string) => {
    if (!rawHtml) return '';
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(rawHtml, 'text/html');
    documentNode.querySelectorAll('script, style, link, meta, base, form').forEach((node) => node.remove());
    documentNode.querySelectorAll('*').forEach((node) => {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'src' || name === 'href' || name === 'xlink:href') && /^javascript:/i.test(value)) {
          node.removeAttribute(attr.name);
        }
      }
    });

    return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        padding: 1rem;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        line-height: 1.55;
        color: #1f2937;
        background: #ffffff;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      img, iframe, table, pre, code, blockquote { max-width: 100%; }
      pre { white-space: pre-wrap; }
    </style>
  </head>
  <body>${documentNode.body.innerHTML}</body>
</html>`.trim();
  };

  const loadInbox = async (sessionId: number, mailbox: string, mode: LoadMode) => {
    const requestId = ++runtime.inboxRequestId;
    abortInboxRequest();

    const controller = new AbortController();
    runtime.inboxController = controller;

    if (mode === 'replace') {
      state.isSwitchingMailbox = true;
      state.isRefreshingInbox = false;
      state.emails = [];
      setStatus(`Opening ${mailbox}...`);
    } else if (!state.isSwitchingMailbox) {
      state.isRefreshingInbox = true;
      setStatus(`Refreshing ${mailbox}...`);
    }

    try {
      const response = await fetch(`/api/emails?to=${encodeURIComponent(mailbox)}`, {
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => []);

      if (!response.ok) {
        throw new Error(readErrorMessage(payload, 'Failed to fetch inbox.'));
      }

      if (!isCurrentMailboxSession(sessionId, mailbox) || requestId !== runtime.inboxRequestId) {
        return;
      }

      state.emails = Array.isArray(payload) ? payload : [];
      
      const stillExists = state.emails.some((e) => e.id === state.selectedEmailId);
      if (!stillExists) resetEmailSelection();

      setStatus(state.emails.length > 0 ? `Inbox ready for ${mailbox}.` : `Waiting for emails in ${mailbox}...`);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      if (!isCurrentMailboxSession(sessionId, mailbox)) return;
      setStatus((error as Error).message || 'Failed to fetch inbox.');
    } finally {
      if (requestId === runtime.inboxRequestId) {
        runtime.inboxController = null;
      }
      if (!isCurrentMailboxSession(sessionId, mailbox)) return;
      if (mode === 'replace') {
        state.isSwitchingMailbox = false;
      } else {
        state.isRefreshingInbox = false;
      }
    }
  };

  const connectMailboxStream = (sessionId: number, mailbox: string) => {
    closeStream();
    const nextStream = new EventSource(`/api/stream?to=${encodeURIComponent(mailbox)}`);
    runtime.stream = nextStream;

    nextStream.addEventListener('ready', () => {
      if (!isCurrentMailboxSession(sessionId, mailbox)) return;
      setStatus(`Live updates active for ${mailbox}.`);
    });

    nextStream.addEventListener('update', () => {
      if (!isCurrentMailboxSession(sessionId, mailbox)) return;
      void loadInbox(sessionId, mailbox, 'refresh');
    });

    nextStream.onerror = () => {
      if (!isCurrentMailboxSession(sessionId, mailbox)) return;
      setStatus(`Live updates reconnecting for ${mailbox}...`);
    };
  };

  const activateMailbox = async (parts: MailboxParts) => {
    runtime.mailboxSessionId += 1;
    const sessionId = runtime.mailboxSessionId;

    stopMailboxEffects();
    syncDraftFromMailbox(parts);
    resetEmailSelection();

    state.showInbox = true;
    state.activeMailbox = parts.mailbox;
    state.activeLocalPart = parts.local;
    state.activeDomain = parts.domain;

    await loadInbox(sessionId, parts.mailbox, 'replace');

    if (!isCurrentMailboxSession(sessionId, parts.mailbox)) return;
    connectMailboxStream(sessionId, parts.mailbox);
  };

  const submitMailbox = async () => {
    const fallbackDomain = state.selectedDomain || availableDomains[0] || config.mailDomain;
    const parts = parseMailboxInput(state.draftLocalPart, fallbackDomain);
    if (!parts) {
      setStatus('Enter a valid mailbox name.');
      alert('Use lowercase letters, numbers, ".", "_" or "-".');
      return;
    }
    await activateMailbox(parts);
  };

  const generateRandomMailbox = async () => {
    if (state.diceRolling) return;
    state.diceRolling = true;
    try {
      const domain = state.selectedDomain || availableDomains[0] || config.mailDomain;
      const response = await fetch(`/api/mailbox/random?domain=${encodeURIComponent(domain)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readErrorMessage(payload, 'Failed to generate mailbox.'));
      const mailbox = typeof payload.mailbox === 'string' ? payload.mailbox : '';
      const parts = parseMailboxInput(mailbox, domain);
      if (!parts) throw new Error('Received invalid mailbox.');
      syncDraftFromMailbox(parts);
      setStatus(`Generated ${parts.mailbox}.`);
    } catch (error) {
      setStatus((error as Error).message || 'Failed to generate mailbox.');
    } finally {
      state.diceRolling = false;
    }
  };

  const openEmail = async (summary: EmailSummary) => {
    if (!state.activeMailbox) return;
    const mailbox = state.activeMailbox;
    const sessionId = runtime.mailboxSessionId;
    const requestId = ++runtime.emailRequestId;

    abortEmailRequest();
    const controller = new AbortController();
    runtime.emailController = controller;

    state.selectedEmailId = summary.id;
    state.selectedEmail = null;
    state.selectedEmailHtml = '';
    state.isLoadingEmail = true;
    state.modalOpen = !state.isDesktop;

    try {
      const response = await fetch(
        `/api/email/${encodeURIComponent(summary.id)}?to=${encodeURIComponent(mailbox)}`,
        { signal: controller.signal }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readErrorMessage(payload, 'Failed to load email.'));
      if (!isCurrentMailboxSession(sessionId, mailbox) || requestId !== runtime.emailRequestId || state.selectedEmailId !== summary.id) {
        return;
      }
      state.selectedEmail = payload as EmailDetail;
      state.selectedEmailHtml = sanitizeHtmlEmail(state.selectedEmail.body_html || '');
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      if (!isCurrentMailboxSession(sessionId, mailbox)) return;
      state.selectedEmail = null;
      state.selectedEmailHtml = '';
      setStatus((error as Error).message || 'Failed to load email.');
      alert('Failed to load email body.');
    } finally {
      if (requestId === runtime.emailRequestId) runtime.emailController = null;
      if (isCurrentMailboxSession(sessionId, mailbox) && state.selectedEmailId === summary.id) {
        state.isLoadingEmail = false;
      }
    }
  };

  const handleAuth = async (mode: 'login' | 'register') => {
    state.auth.loading = true;
    try {
      const optionsResponse = await fetch(`/api/auth/${mode}/options`, { method: 'POST' });
      const optionsPayload = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok) throw new Error(readErrorMessage(optionsPayload, `${mode} failed.`));
      const credential = mode === 'register'
        ? await startRegistration({ optionsJSON: optionsPayload.options })
        : await startAuthentication({ optionsJSON: optionsPayload.options });
      const verifyResponse = await fetch(`/api/auth/${mode}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok) throw new Error(readErrorMessage(verifyPayload, 'Passkey verification failed.'));
      state.auth.authenticated = true;
      state.auth.hasOwner = true;
      setStatus('Passkey verified.');
      await generateRandomMailbox();
    } catch (error) {
      alert((error as Error).message || 'Authentication failed.');
    } finally {
      state.auth.loading = false;
    }
  };

  const checkAuth = async () => {
    if (!state.auth.enabled) {
      state.auth.loading = false;
      return;
    }
    state.auth.loading = true;
    try {
      const response = await fetch('/api/auth/status');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readErrorMessage(payload, 'Failed to load auth status.'));
      state.auth.hasOwner = Boolean(payload.hasOwner);
      state.auth.authenticated = Boolean(payload.authenticated);
      if (state.auth.authenticated) {
        setStatus('Passkey session active.');
        await generateRandomMailbox();
      }
    } catch {
      setStatus('Failed to verify passkey session.');
    } finally {
      state.auth.loading = false;
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // --- View Functions ---

  const InboxItem = (email: EmailSummary) => html`
    <div
      class="${() => {
        const isSelected = state.selectedEmailId === email.id;
        const loadingClass = isSelected && state.isLoadingEmail ? ' is-loading' : '';
        return `email-item${isSelected ? ' is-active' : ''}${loadingClass}`;
      }}"
      @click="${() => openEmail(email)}"
    >
      <div class="email-row">
        <div class="subject">${() => email.subject || '(No Subject)'}</div>
        <span class="meta">${() => formatTime(email.timestamp)}</span>
      </div>
      <div class="meta">${() => `From: ${email.id_from}`}</div>
      <div class="snippet">${() => email.preview || 'No preview available'}</div>
    </div>
  `.key(email.id);

  const skeletonView = () => html`
    <div class="stack-sm">
      ${[0, 1, 2].map((index) => html`
        <div class="email-item email-skeleton" aria-hidden="true">
          <div class="skeleton-line skeleton-subject"></div>
          <div class="skeleton-line skeleton-from"></div>
          <div class="skeleton-line skeleton-snippet"></div>
        </div>
      `.key(`skeleton-${index}`))}
    </div>
  `;

  const emptyInboxView = () => html`
    <div class="empty-state-compact">
      <p>No emails at <b>${() => state.activeMailbox}</b> yet.</p>
    </div>
  `;

  const inboxListView = () => {
    if (state.isSwitchingMailbox) return skeletonView();
    if (state.emails.length === 0) return emptyInboxView();
    return html`
      <div class="stack-sm">
        ${() => state.emails.map((email) => InboxItem(email))}
      </div>
    `;
  };

  const detailEmptyView = (title: string, description: string) => html`
    <div class="detail-empty">
      <h3>${title}</h3>
      <p>${description}</p>
    </div>
  `;

  const emailDetailView = () => {
    if (!state.showInbox) return detailEmptyView('Welcome to Hana Mail', 'Open a mailbox to start reading messages.');
    if (state.isLoadingEmail) return html`<div class="detail-loading"><div class="skeleton-block"></div></div>`;
    if (!state.selectedEmail) return detailEmptyView('Select an email', `Mailbox ${state.activeMailbox} is ready.`);
    const email = state.selectedEmail;
    return html`
      <div class="detail-content">
        <div class="detail-head">
          <h2>${email.subject || '(No Subject)'}</h2>
          <p class="meta">From: ${email.id_from}</p>
        </div>
        <hr class="detail-divider" />
        ${() => state.selectedEmailHtml
          ? html`<iframe class="email-html-frame" .srcdoc="${state.selectedEmailHtml}" sandbox="allow-popups"></iframe>`
          : html`<pre class="text-body">${email.body_text || 'No message body.'}</pre>`}
      </div>
    `;
  };

  const authView = () => {
    if (state.auth.loading) return detailEmptyView('Verifying', 'Checking passkey access...');
    if (!state.auth.hasOwner) {
      return html`
        <div class="detail-empty detail-welcome">
          <div class="empty-icon">🔐</div>
          <h3>Setup Owner</h3>
          <p>Register a passkey before accessing inboxes.</p>
          <button @click="${() => handleAuth('register')}">Create Passkey</button>
        </div>
      `;
    }
    return html`
      <div class="detail-empty detail-welcome">
        <div class="empty-icon">🔑</div>
        <h3>Owner Required</h3>
        <p>Authenticate with your existing passkey.</p>
        <button @click="${() => handleAuth('login')}">Login with Passkey</button>
      </div>
    `;
  };

  const mainView = () => html`
    <div class="hero">
      <div class="hero-badge">Hana Mail</div>
      <h1>Temporary Mail</h1>
      <p class="sub">Open any mailbox instantly and switch inboxes without stale state.</p>
    </div>
    <div class="page-main">
      <aside class="sidebar">
        <div class="card">
          <div class="selector">
            <div class="input-wrap multi-domain">
              <input id="mailbox-local-part-input" type="text" placeholder="name"
                .value="${() => state.draftLocalPart}"
                @input="${(event: Event) => {
                  const target = event.target as HTMLInputElement;
                  state.draftLocalPart = normalizeDraftInput(target.value);
                }}"
                @keydown="${(event: KeyboardEvent) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  void submitMailbox();
                }}"
              />
              <div class="domain-select-wrap">
                <span class="domain-at">@</span>
                <select class="domain-select" .value="${() => state.selectedDomain}"
                  @change="${(event: Event) => {
                    const target = event.target as HTMLSelectElement;
                    state.selectedDomain = target.value;
                  }}"
                >
                  ${state.availableDomains.map((domain) => html`<option value="${domain}">${domain}</option>`.key(domain))}
                </select>
              </div>
              <button type="button" class="dice-btn ${() => state.diceRolling ? 'is-rolling' : ''}" @click="${() => void generateRandomMailbox()}">🎲</button>
            </div>
            <button type="button" style="width:100%" ?disabled="${() => state.isSwitchingMailbox}" @click="${() => void submitMailbox()}">
              ${() => state.isSwitchingMailbox ? 'Opening...' : 'Open Inbox'}
            </button>
          </div>
          <div class="status">${() => state.status}</div>
        </div>
        ${() => state.showInbox ? html`
          <div class="email-list-wrap card">
            <div class="inbox-head">
              <b>${() => state.activeMailbox}</b>
              <span class="meta">${() => state.isRefreshingInbox ? 'Refreshing...' : `${state.emails.length} messages`}</span>
            </div>
            <div class="email-list-body">${() => inboxListView()}</div>
          </div>
        ` : ''}
      </aside>
      <section class="detail-panel">${() => emailDetailView()}</section>
    </div>
    <div class="modal ${() => state.modalOpen ? 'show' : ''}" @click="${() => { state.modalOpen = false; }}">
      <div class="modal-content" @click="${(event: Event) => { event.stopPropagation(); }}">
        ${() => emailDetailView()}
        <button type="button" style="width:100%; margin-top: 1rem" @click="${() => { state.modalOpen = false; }}">Close</button>
      </div>
    </div>
  `;

  const appView = html`
    ${() => state.auth.enabled && !state.auth.authenticated ? authView() : mainView()}
  `;

  const handleViewportChange = (event?: MediaQueryListEvent) => {
    state.isDesktop = event ? event.matches : desktopMediaQuery.matches;
    if (state.isDesktop) state.modalOpen = false;
  };

  appView(root);

  if (typeof desktopMediaQuery.addEventListener === 'function') {
    desktopMediaQuery.addEventListener('change', handleViewportChange);
  } else {
    desktopMediaQuery.addListener(handleViewportChange);
  }

  window.addEventListener('beforeunload', stopMailboxEffects, { once: true });
  void checkAuth();
  if (!state.auth.enabled) void generateRandomMailbox();
}
