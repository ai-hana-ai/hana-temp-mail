import { mailboxLocalPartPattern } from './validation';

type HomePageOptions = {
  passkeyEnabled?: boolean;
};

type HomePageConfig = {
  mailDomain: string;
  mailDomains: string[];
  passkeyEnabled: boolean;
  mailboxLocalPartRegexSource: string;
};

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return char;
    }
  });
}

function buildStyles(): string {
  return `
    :root {
      --bg: #f2f5fb;
      --panel: #ffffff;
      --panel-soft: #f7f9fc;
      --line: #d9e0ea;
      --text: #142033;
      --muted: #5f6c80;
      --accent: #1463ff;
      --accent-2: #0f4dcc;
      --danger: #d13d4b;
      --shadow: 0 20px 40px rgba(20, 32, 51, 0.08);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(20, 99, 255, 0.10), transparent 30%),
        linear-gradient(180deg, #f6f8fc 0%, #eef3f9 100%);
    }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
    #app[data-cloak] { display: none !important; }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 16px 40px;
    }
    .hero {
      margin-bottom: 20px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(20, 99, 255, 0.10);
      color: var(--accent-2);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    h1 {
      margin: 14px 0 8px;
      font-size: clamp(2rem, 4vw, 3.2rem);
      line-height: 1.05;
      letter-spacing: -0.04em;
    }
    .lead {
      margin: 0;
      max-width: 720px;
      color: var(--muted);
      font-size: 1rem;
    }
    .layout {
      display: grid;
      gap: 20px;
    }
    .card {
      background: linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: var(--shadow);
    }
    .sidebar {
      display: grid;
      gap: 16px;
      min-width: 0;
    }
    .panel {
      padding: 18px;
    }
    .selector-grid {
      display: grid;
      gap: 12px;
    }
    .mailbox-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: stretch;
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
      background: #fff;
    }
    .mailbox-row:focus-within {
      border-color: rgba(20, 99, 255, 0.4);
      box-shadow: 0 0 0 3px rgba(20, 99, 255, 0.12);
    }
    .mailbox-row input,
    .mailbox-row select {
      border: 0;
      outline: 0;
      background: transparent;
      min-width: 0;
    }
    .mailbox-row input {
      padding: 14px 16px;
      text-transform: lowercase;
    }
    .domain-wrap {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 14px;
      border-left: 1px solid var(--line);
      color: var(--muted);
      background: var(--panel-soft);
    }
    .domain-wrap select {
      padding: 14px 20px 14px 0;
      color: var(--text);
      font-weight: 600;
      appearance: none;
      background:
        linear-gradient(45deg, transparent 50%, var(--muted) 50%) calc(100% - 12px) calc(50% - 2px) / 6px 6px no-repeat,
        linear-gradient(135deg, var(--muted) 50%, transparent 50%) calc(100% - 8px) calc(50% - 2px) / 6px 6px no-repeat;
    }
    .ghost-dice {
      width: 52px;
      border: 0;
      border-left: 1px solid var(--line);
      background: #fff;
      font-size: 22px;
    }
    .ghost-dice.is-rolling { animation: dice-spin 0.8s linear infinite; }
    @keyframes dice-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .actions {
      display: grid;
      gap: 10px;
      grid-template-columns: minmax(0, 1fr);
    }
    .action-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 46px;
      padding: 0 16px;
      border-radius: 14px;
      border: 0;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
      color: #fff;
      font-weight: 700;
      text-decoration: none;
    }
    .btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .btn-secondary {
      background: #fff;
      color: var(--text);
      border: 1px solid var(--line);
    }
    .status {
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--panel-soft);
      border: 1px dashed var(--line);
      color: var(--muted);
      font-size: 0.95rem;
    }
    .status[data-tone="error"] {
      color: var(--danger);
      border-color: rgba(209, 61, 75, 0.25);
      background: rgba(209, 61, 75, 0.06);
    }
    .inbox-panel[hidden] { display: none; }
    .inbox-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
    }
    .mailbox-name {
      font-size: 1rem;
      font-weight: 700;
      word-break: break-word;
    }
    .meta {
      color: var(--muted);
      font-size: 0.88rem;
    }
    .email-list {
      display: grid;
      gap: 12px;
    }
    .email-item {
      width: 100%;
      padding: 14px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: #fff;
      text-align: left;
    }
    .email-item.is-active {
      border-color: rgba(20, 99, 255, 0.4);
      background: rgba(20, 99, 255, 0.05);
    }
    .email-item.is-loading {
      cursor: progress;
    }
    .email-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .email-subject {
      font-weight: 700;
      word-break: break-word;
    }
    .email-from,
    .email-preview {
      color: var(--muted);
      word-break: break-word;
    }
    .empty,
    .auth-box,
    .detail-empty,
    .detail-loading {
      display: grid;
      gap: 12px;
      align-content: center;
      justify-items: start;
      min-height: 280px;
      padding: 22px;
      border-radius: 18px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
      border: 1px solid var(--line);
    }
    .empty.center,
    .auth-box,
    .detail-empty,
    .detail-loading {
      justify-items: center;
      text-align: center;
    }
    .auth-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .detail-shell {
      min-height: 100%;
    }
    .detail-panel {
      min-width: 0;
    }
    .detail-panel .panel,
    .detail-modal-card {
      min-height: 100%;
    }
    .detail-card {
      display: grid;
      gap: 16px;
      min-height: 100%;
    }
    .detail-header h2 {
      margin: 0 0 8px;
      font-size: 1.5rem;
      line-height: 1.15;
      word-break: break-word;
    }
    .detail-body {
      min-height: 280px;
    }
    .text-body {
      margin: 0;
      padding: 16px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: var(--panel-soft);
      white-space: pre-wrap;
      word-break: break-word;
      overflow: auto;
    }
    .email-frame {
      width: 100%;
      min-height: 440px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
    }
    .skeleton {
      position: relative;
      overflow: hidden;
      border-radius: 999px;
      background: linear-gradient(90deg, #e9eef6 0%, #f8fbff 50%, #e9eef6 100%);
      background-size: 200% 100%;
      animation: shimmer 1.2s linear infinite;
    }
    .skeleton-block {
      height: 16px;
      margin-bottom: 10px;
    }
    .skeleton-block.large {
      height: 220px;
      border-radius: 16px;
      margin: 0;
    }
    @keyframes shimmer {
      from { background-position: 200% 0; }
      to { background-position: -200% 0; }
    }
    .modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(20, 32, 51, 0.55);
      z-index: 20;
    }
    .modal.show { display: flex; }
    .detail-modal-card {
      width: min(860px, 100%);
      max-height: calc(100dvh - 32px);
      overflow: auto;
      padding: 18px;
    }
    .close-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .footer {
      margin-top: 18px;
      color: var(--muted);
      font-size: 0.88rem;
      text-align: center;
    }
    @media (min-width: 1024px) {
      .page {
        padding: 28px 24px 48px;
      }
      .layout {
        grid-template-columns: minmax(340px, 380px) minmax(0, 1fr);
        align-items: stretch;
      }
      .detail-panel {
        display: block;
      }
      .modal { display: none !important; }
    }
    @media (max-width: 1023.98px) {
      .detail-panel {
        display: none;
      }
      .detail-body {
        min-height: auto;
      }
      .email-frame {
        min-height: 360px;
      }
    }
  `;
}

function buildClientScript(config: HomePageConfig): string {
  const serializedConfig = serializeForInlineScript(config);

  return `
    import { reactive } from 'https://esm.sh/@arrow-js/core';
    import { startAuthentication, startRegistration } from 'https://esm.sh/@simplewebauthn/browser';

    const config = ${serializedConfig};
    const root = document.getElementById('app');

    if (!root) {
      throw new Error('Missing app root.');
    }

    const mailboxPattern = new RegExp(config.mailboxLocalPartRegexSource);
    const mediaQuery = window.matchMedia('(min-width: 1024px)');

    const state = reactive({
      draftLocalPart: '',
      selectedDomain: config.mailDomains[0] || config.mailDomain,
      availableDomains: Array.isArray(config.mailDomains) && config.mailDomains.length > 0 ? config.mailDomains : [config.mailDomain],
      activeMailbox: '',
      activeLocalPart: '',
      activeDomain: '',
      showInbox: false,
      emails: [],
      selectedEmailId: '',
      selectedEmail: null,
      selectedEmailHtml: '',
      status: 'Ready.',
      statusTone: 'neutral',
      diceRolling: false,
      isSwitchingMailbox: false,
      isRefreshingInbox: false,
      isLoadingEmail: false,
      modalOpen: false,
      isDesktop: mediaQuery.matches,
      auth: {
        enabled: Boolean(config.passkeyEnabled),
        hasOwner: false,
        authenticated: !config.passkeyEnabled,
        loading: Boolean(config.passkeyEnabled),
      },
    });

    const runtime = {
      shell: '',
      mailboxSessionId: 0,
      inboxRequestId: 0,
      emailRequestId: 0,
      stream: null,
      inboxController: null,
      emailController: null,
    };

    function readErrorMessage(payload, fallback) {
      if (payload && typeof payload === 'object' && typeof payload.error === 'string') {
        return payload.error;
      }
      return fallback;
    }

    function setStatus(message, tone = 'neutral') {
      state.status = message;
      state.statusTone = tone;
      renderStatus();
    }

    function normalizeDraft(value) {
      return String(value || '').trim().toLowerCase();
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    function parseMailboxInput(value, fallbackDomain) {
      const normalized = normalizeDraft(value);
      if (!normalized) return null;

      if (normalized.includes('@')) {
        const parts = normalized.split('@');
        if (parts.length !== 2) return null;
        const local = parts[0];
        const domain = parts[1];
        if (!mailboxPattern.test(local)) return null;
        if (!state.availableDomains.includes(domain)) return null;
        return { local, domain, mailbox: local + '@' + domain };
      }

      if (!mailboxPattern.test(normalized)) return null;
      return {
        local: normalized,
        domain: fallbackDomain,
        mailbox: normalized + '@' + fallbackDomain,
      };
    }

    function sanitizeHtmlEmail(rawHtml) {
      if (!rawHtml) return '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(String(rawHtml), 'text/html');

      doc.querySelectorAll('script, style, link, meta, base, form').forEach((node) => node.remove());

      doc.querySelectorAll('*').forEach((node) => {
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

      return '<!doctype html><html><head><meta charset="utf-8"><style>' +
        ':root{color-scheme:light;}body{margin:0;padding:16px;font-family:IBM Plex Sans,Segoe UI,sans-serif;line-height:1.55;color:#142033;background:#fff;word-break:break-word;overflow-wrap:anywhere;}img,table,pre,code,blockquote{max-width:100%;}pre{white-space:pre-wrap;}' +
        '</style></head><body>' + doc.body.innerHTML + '</body></html>';
    }

    function isCurrentMailboxSession(sessionId, mailbox) {
      return sessionId === runtime.mailboxSessionId && state.activeMailbox === mailbox;
    }

    function stopStream() {
      if (!runtime.stream) return;
      runtime.stream.close();
      runtime.stream = null;
    }

    function abortInboxRequest() {
      if (!runtime.inboxController) return;
      runtime.inboxController.abort();
      runtime.inboxController = null;
    }

    function abortEmailRequest() {
      if (!runtime.emailController) return;
      runtime.emailController.abort();
      runtime.emailController = null;
    }

    function stopMailboxEffects() {
      stopStream();
      abortInboxRequest();
      abortEmailRequest();
    }

    function resetEmailSelection() {
      state.selectedEmailId = '';
      state.selectedEmail = null;
      state.selectedEmailHtml = '';
      state.isLoadingEmail = false;
      state.modalOpen = false;
      renderDetail();
    }

    function getById(id) {
      return document.getElementById(id);
    }

    function renderRoot() {
      const nextShell = state.auth.enabled && !state.auth.authenticated ? 'auth' : 'app';
      if (runtime.shell === nextShell) return;

      if (nextShell === 'auth') {
        root.innerHTML =
          '<div class="page">' +
            '<section class="hero">' +
              '<div class="eyebrow">Hana Mail</div>' +
              '<h1>Temporary Mail Inbox</h1>' +
              '<p class="lead">Passkey protection is enabled. Authenticate before opening or switching mailboxes.</p>' +
            '</section>' +
            '<section class="card panel">' +
              '<div id="auth-box" class="auth-box"></div>' +
            '</section>' +
            '<div class="footer">Realtime inbox updates stay on Server-Sent Events.</div>' +
          '</div>';
      } else {
        root.innerHTML =
          '<div class="page">' +
            '<section class="hero">' +
              '<div class="eyebrow">Hana Mail</div>' +
              '<h1>Temporary Mail Inbox</h1>' +
              '<p class="lead">Open any mailbox instantly, switch domains without stale state, and follow new mail over SSE.</p>' +
            '</section>' +
            '<section class="layout">' +
              '<aside class="sidebar">' +
                '<section class="card panel">' +
                  '<div class="selector-grid">' +
                    '<div class="mailbox-row">' +
                      '<input id="mailbox-local-part" type="text" inputmode="email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="local-part">' +
                      '<label class="domain-wrap" for="mailbox-domain"><span>@</span><select id="mailbox-domain"></select></label>' +
                      '<button id="random-mailbox" class="ghost-dice" type="button" aria-label="Generate random mailbox">🎲</button>' +
                    '</div>' +
                    '<div class="action-row">' +
                      '<button id="open-mailbox" class="btn" type="button">Open Inbox</button>' +
                      '<button id="logout-button" class="btn btn-secondary" type="button" hidden>Logout</button>' +
                    '</div>' +
                    '<div id="status-box" class="status"></div>' +
                  '</div>' +
                '</section>' +
                '<section id="inbox-panel" class="card panel inbox-panel" hidden>' +
                  '<div class="inbox-head">' +
                    '<div id="active-mailbox" class="mailbox-name"></div>' +
                    '<div id="inbox-meta" class="meta"></div>' +
                  '</div>' +
                  '<div id="email-list" class="email-list"></div>' +
                '</section>' +
              '</aside>' +
              '<section class="card panel detail-panel">' +
                '<div id="detail-panel-body" class="detail-shell"></div>' +
              '</section>' +
            '</section>' +
            '<div id="detail-modal" class="modal" aria-hidden="true">' +
              '<div class="card detail-modal-card">' +
                '<div id="detail-modal-body"></div>' +
                '<div class="close-row"><button id="close-modal" class="btn btn-secondary" type="button">Close</button></div>' +
              '</div>' +
            '</div>' +
            '<div class="footer">Mailbox domains come from server configuration. HTML emails stay sandboxed.</div>' +
          '</div>';
      }

      runtime.shell = nextShell;
      bindShellEvents();
      refreshVisibleUI();
      root.removeAttribute('data-cloak');
    }

    function bindShellEvents() {
      const authButton = getById('auth-button');
      if (authButton) {
        authButton.addEventListener('click', () => {
          void handleAuth(authButton.getAttribute('data-mode') || 'login');
        });
      }

      const input = getById('mailbox-local-part');
      if (input) {
        input.addEventListener('input', (event) => {
          state.draftLocalPart = normalizeDraft(event.target.value);
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void submitMailbox();
        });
      }

      const select = getById('mailbox-domain');
      if (select) {
        select.addEventListener('change', (event) => {
          state.selectedDomain = event.target.value;
        });
      }

      const randomButton = getById('random-mailbox');
      if (randomButton) {
        randomButton.addEventListener('click', () => {
          void generateRandomMailbox();
        });
      }

      const openButton = getById('open-mailbox');
      if (openButton) {
        openButton.addEventListener('click', () => {
          void submitMailbox();
        });
      }

      const logoutButton = getById('logout-button');
      if (logoutButton) {
        logoutButton.addEventListener('click', () => {
          void logout();
        });
      }

      const modal = getById('detail-modal');
      if (modal) {
        modal.addEventListener('click', (event) => {
          if (event.target !== modal) return;
          state.modalOpen = false;
          renderModal();
        });
      }

      const closeButton = getById('close-modal');
      if (closeButton) {
        closeButton.addEventListener('click', () => {
          state.modalOpen = false;
          renderModal();
        });
      }
    }

    function renderStatus() {
      const box = getById('status-box');
      if (!box) return;
      box.textContent = state.status;
      box.setAttribute('data-tone', state.statusTone);
    }

    function renderAuthBox() {
      const box = getById('auth-box');
      if (!box) return;

      if (state.auth.loading) {
        box.innerHTML =
          '<div class="eyebrow">Passkey</div>' +
          '<h2>Checking session</h2>' +
          '<p class="lead">Verifying whether an owner passkey already exists.</p>';
        return;
      }

      const mode = state.auth.hasOwner ? 'login' : 'register';
      const title = state.auth.hasOwner ? 'Owner authentication required' : 'Create the owner passkey';
      const copy = state.auth.hasOwner
        ? 'Authenticate with the existing passkey before you access the inbox workspace.'
        : 'The first visitor becomes the owner. Register a passkey once, then future visits will require login.';
      const buttonLabel = state.auth.hasOwner ? 'Login With Passkey' : 'Create Passkey';

      box.innerHTML =
        '<div class="eyebrow">Passkey</div>' +
        '<h2>' + escapeHtml(title) + '</h2>' +
        '<p class="lead">' + escapeHtml(copy) + '</p>' +
        '<div class="auth-actions">' +
          '<button id="auth-button" class="btn" type="button" data-mode="' + mode + '">' + escapeHtml(buttonLabel) + '</button>' +
        '</div>';

      bindShellEvents();
    }

    function renderSelector() {
      const input = getById('mailbox-local-part');
      if (input && input.value !== state.draftLocalPart) {
        input.value = state.draftLocalPart;
      }

      const select = getById('mailbox-domain');
      if (select) {
        const optionsHtml = state.availableDomains
          .map((domain) => '<option value="' + escapeHtml(domain) + '">' + escapeHtml(domain) + '</option>')
          .join('');
        if (select.innerHTML !== optionsHtml) {
          select.innerHTML = optionsHtml;
        }
        select.value = state.selectedDomain;
      }

      const openButton = getById('open-mailbox');
      if (openButton) {
        openButton.disabled = state.isSwitchingMailbox;
        openButton.textContent = state.isSwitchingMailbox ? 'Opening...' : 'Open Inbox';
      }

      const randomButton = getById('random-mailbox');
      if (randomButton) {
        randomButton.classList.toggle('is-rolling', state.diceRolling);
        randomButton.disabled = state.diceRolling;
      }

      const logoutButton = getById('logout-button');
      if (logoutButton) {
        logoutButton.hidden = !(state.auth.enabled && state.auth.authenticated);
      }
    }

    function inboxListHtml() {
      if (state.isSwitchingMailbox) {
        return [
          '<div class="email-item" aria-hidden="true">',
          '<div class="skeleton skeleton-block" style="width:62%"></div>',
          '<div class="skeleton skeleton-block" style="width:38%"></div>',
          '<div class="skeleton skeleton-block" style="width:100%; margin-bottom:0"></div>',
          '</div>',
          '<div class="email-item" aria-hidden="true">',
          '<div class="skeleton skeleton-block" style="width:56%"></div>',
          '<div class="skeleton skeleton-block" style="width:34%"></div>',
          '<div class="skeleton skeleton-block" style="width:92%; margin-bottom:0"></div>',
          '</div>',
        ].join('');
      }

      if (state.emails.length === 0) {
        return '<div class="empty center"><h3>No emails yet</h3><p class="lead">Incoming messages for <strong>' +
          escapeHtml(state.activeMailbox) +
          '</strong> will appear here automatically.</p></div>';
      }

      return state.emails.map((email) => {
        const isActive = state.selectedEmailId === email.id;
        const itemClass = 'email-item' + (isActive ? ' is-active' : '') + (isActive && state.isLoadingEmail ? ' is-loading' : '');
        return (
          '<button class="' + itemClass + '" type="button" data-email-id="' + escapeHtml(email.id) + '">' +
            '<div class="email-top">' +
              '<div class="email-subject">' + escapeHtml(email.subject || '(No Subject)') + '</div>' +
              '<div class="meta">' + escapeHtml(formatTime(email.timestamp)) + '</div>' +
            '</div>' +
            '<div class="email-from">From: ' + escapeHtml(email.id_from || '') + '</div>' +
            '<div class="email-preview">' + escapeHtml(email.preview || 'No preview available') + '</div>' +
          '</button>'
        );
      }).join('');
    }

    function bindInboxItems() {
      document.querySelectorAll('[data-email-id]').forEach((element) => {
        element.addEventListener('click', () => {
          const emailId = element.getAttribute('data-email-id') || '';
          const summary = state.emails.find((item) => item.id === emailId);
          if (!summary) return;
          void openEmail(summary);
        });
      });
    }

    function renderInbox() {
      const panel = getById('inbox-panel');
      if (!panel) return;

      panel.hidden = !state.showInbox;
      if (!state.showInbox) return;

      const mailboxName = getById('active-mailbox');
      if (mailboxName) mailboxName.textContent = state.activeMailbox;

      const inboxMeta = getById('inbox-meta');
      if (inboxMeta) {
        const label = state.isRefreshingInbox
          ? 'Refreshing...'
          : state.emails.length + ' message' + (state.emails.length === 1 ? '' : 's');
        inboxMeta.textContent = label;
      }

      const list = getById('email-list');
      if (!list) return;
      list.innerHTML = inboxListHtml();
      bindInboxItems();
    }

    function detailContentHtml() {
      if (!state.showInbox) {
        return '<div class="detail-empty"><div class="eyebrow">Inbox</div><h2>Open a mailbox first</h2><p class="lead">The inbox list stays hidden until you explicitly activate one mailbox.</p></div>';
      }

      if (state.isLoadingEmail) {
        return '<div class="detail-loading"><div class="eyebrow">Loading</div><div class="skeleton skeleton-block" style="width:50%"></div><div class="skeleton skeleton-block" style="width:72%"></div><div class="skeleton skeleton-block large"></div></div>';
      }

      if (!state.selectedEmail) {
        return '<div class="detail-empty"><div class="eyebrow">Mailbox Ready</div><h2>' + escapeHtml(state.activeMailbox) + '</h2><p class="lead">Select an email from the list to read the sanitized HTML body or plain-text fallback.</p></div>';
      }

      return (
        '<article class="detail-card">' +
          '<header class="detail-header">' +
            '<div class="eyebrow">Email Detail</div>' +
            '<h2>' + escapeHtml(state.selectedEmail.subject || '(No Subject)') + '</h2>' +
            '<div class="meta">From: ' + escapeHtml(state.selectedEmail.id_from || '') + '</div>' +
            '<div class="meta">' + escapeHtml(formatTime(state.selectedEmail.timestamp || '')) + '</div>' +
          '</header>' +
          '<div id="detail-body-content" class="detail-body"></div>' +
        '</article>'
      );
    }

    function injectDetailBody(container) {
      const target = container.querySelector('#detail-body-content');
      if (!target || !state.selectedEmail) return;

      if (state.selectedEmailHtml) {
        const frame = document.createElement('iframe');
        frame.className = 'email-frame';
        frame.setAttribute('sandbox', 'allow-popups');
        frame.srcdoc = state.selectedEmailHtml;
        target.replaceChildren(frame);
        return;
      }

      const pre = document.createElement('pre');
      pre.className = 'text-body';
      pre.textContent = state.selectedEmail.body_text || 'No message body.';
      target.replaceChildren(pre);
    }

    function renderDetail() {
      const desktop = getById('detail-panel-body');
      if (desktop) {
        desktop.innerHTML = detailContentHtml();
        injectDetailBody(desktop);
      }
      renderModal();
    }

    function renderModal() {
      const modal = getById('detail-modal');
      const body = getById('detail-modal-body');
      if (!modal || !body) return;

      modal.classList.toggle('show', Boolean(state.modalOpen && !state.isDesktop));
      modal.setAttribute('aria-hidden', state.modalOpen && !state.isDesktop ? 'false' : 'true');
      body.innerHTML = detailContentHtml();
      injectDetailBody(body);
    }

    function refreshVisibleUI() {
      if (runtime.shell === 'auth') {
        renderAuthBox();
        return;
      }
      renderSelector();
      renderStatus();
      renderInbox();
      renderDetail();
    }

    async function loadInbox(sessionId, mailbox, mode) {
      const requestId = ++runtime.inboxRequestId;

      abortInboxRequest();
      const controller = new AbortController();
      runtime.inboxController = controller;

      if (mode === 'replace') {
        state.isSwitchingMailbox = true;
        state.isRefreshingInbox = false;
        state.emails = [];
        renderSelector();
        renderInbox();
        setStatus('Opening ' + mailbox + '...');
      } else if (!state.isSwitchingMailbox) {
        state.isRefreshingInbox = true;
        renderInbox();
      }

      try {
        const response = await fetch('/api/emails?to=' + encodeURIComponent(mailbox), {
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => []);

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, 'Failed to load inbox.'));
        }

        if (!isCurrentMailboxSession(sessionId, mailbox) || requestId !== runtime.inboxRequestId) {
          return;
        }

        state.emails = Array.isArray(payload) ? payload : [];

        if (!state.emails.some((email) => email.id === state.selectedEmailId)) {
          resetEmailSelection();
        }

        if (state.emails.length > 0) {
          setStatus('Inbox ready for ' + mailbox + '.');
        } else {
          setStatus('Waiting for emails in ' + mailbox + '...');
        }
      } catch (error) {
        if (error && error.name === 'AbortError') return;
        if (!isCurrentMailboxSession(sessionId, mailbox)) return;
        setStatus(error && error.message ? error.message : 'Failed to load inbox.', 'error');
      } finally {
        if (requestId === runtime.inboxRequestId) {
          runtime.inboxController = null;
        }
        if (!isCurrentMailboxSession(sessionId, mailbox)) return;
        if (mode === 'replace') {
          state.isSwitchingMailbox = false;
          renderSelector();
        } else {
          state.isRefreshingInbox = false;
        }
        renderInbox();
      }
    }

    function connectMailboxStream(sessionId, mailbox) {
      stopStream();

      const stream = new EventSource('/api/stream?to=' + encodeURIComponent(mailbox));
      runtime.stream = stream;

      stream.addEventListener('ready', () => {
        if (!isCurrentMailboxSession(sessionId, mailbox)) return;
        setStatus('Live updates active for ' + mailbox + '.');
      });

      stream.addEventListener('update', () => {
        if (!isCurrentMailboxSession(sessionId, mailbox)) return;
        void loadInbox(sessionId, mailbox, 'refresh');
      });

      stream.onerror = () => {
        if (!isCurrentMailboxSession(sessionId, mailbox)) return;
        setStatus('Live updates reconnecting for ' + mailbox + '...');
      };
    }

    async function activateMailbox(parts) {
      runtime.mailboxSessionId += 1;
      const sessionId = runtime.mailboxSessionId;

      stopMailboxEffects();
      resetEmailSelection();

      state.showInbox = true;
      state.activeMailbox = parts.mailbox;
      state.activeLocalPart = parts.local;
      state.activeDomain = parts.domain;
      state.draftLocalPart = parts.local;
      state.selectedDomain = parts.domain;

      renderSelector();
      renderInbox();
      renderDetail();

      await loadInbox(sessionId, parts.mailbox, 'replace');

      if (!isCurrentMailboxSession(sessionId, parts.mailbox)) return;
      connectMailboxStream(sessionId, parts.mailbox);
    }

    async function submitMailbox() {
      const fallbackDomain = state.selectedDomain || state.availableDomains[0] || config.mailDomain;
      const parts = parseMailboxInput(state.draftLocalPart, fallbackDomain);

      if (!parts) {
        setStatus('Use lowercase letters, numbers, dots, underscores, or hyphens only.', 'error');
        window.alert('Enter a valid mailbox local-part.');
        return;
      }

      await activateMailbox(parts);
    }

    async function generateRandomMailbox() {
      if (state.diceRolling) return;
      state.diceRolling = true;
      renderSelector();

      try {
        const domain = state.selectedDomain || state.availableDomains[0] || config.mailDomain;
        const response = await fetch('/api/mailbox/random?domain=' + encodeURIComponent(domain));
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, 'Failed to generate mailbox.'));
        }

        if (Array.isArray(payload.domains) && payload.domains.length > 0) {
          state.availableDomains = payload.domains.map((value) => String(value).toLowerCase());
        }

        const mailbox = typeof payload.mailbox === 'string' ? payload.mailbox : '';
        const parts = parseMailboxInput(mailbox, domain);
        if (!parts) {
          throw new Error('Received invalid mailbox.');
        }

        state.draftLocalPart = parts.local;
        state.selectedDomain = parts.domain;
        renderSelector();
        setStatus('Generated ' + parts.mailbox + '.');
      } catch (error) {
        setStatus(error && error.message ? error.message : 'Failed to generate mailbox.', 'error');
      } finally {
        state.diceRolling = false;
        renderSelector();
      }
    }

    async function openEmail(summary) {
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
      renderInbox();
      renderDetail();

      try {
        const response = await fetch('/api/email/' + encodeURIComponent(summary.id) + '?to=' + encodeURIComponent(mailbox), {
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, 'Failed to load email.'));
        }

        if (!isCurrentMailboxSession(sessionId, mailbox) || requestId !== runtime.emailRequestId || state.selectedEmailId !== summary.id) {
          return;
        }

        state.selectedEmail = payload;
        state.selectedEmailHtml = sanitizeHtmlEmail(state.selectedEmail.body_html || '');
      } catch (error) {
        if (error && error.name === 'AbortError') return;
        if (!isCurrentMailboxSession(sessionId, mailbox)) return;
        state.selectedEmail = null;
        state.selectedEmailHtml = '';
        setStatus(error && error.message ? error.message : 'Failed to load email.', 'error');
        window.alert('Failed to load email body.');
      } finally {
        if (requestId === runtime.emailRequestId) {
          runtime.emailController = null;
        }
        if (isCurrentMailboxSession(sessionId, mailbox) && state.selectedEmailId === summary.id) {
          state.isLoadingEmail = false;
          renderInbox();
          renderDetail();
        }
      }
    }

    async function handleAuth(mode) {
      state.auth.loading = true;
      renderAuthBox();

      try {
        const optionsResponse = await fetch('/api/auth/' + mode + '/options', { method: 'POST' });
        const optionsPayload = await optionsResponse.json().catch(() => ({}));

        if (!optionsResponse.ok) {
          throw new Error(readErrorMessage(optionsPayload, 'Passkey request failed.'));
        }

        let responsePayload;
        if (mode === 'register') {
          const credential = await startRegistration({
            optionsJSON: optionsPayload.options,
            useAutoRegister: false,
          });
          responsePayload = credential;
        } else {
          const credential = await startAuthentication({
            optionsJSON: optionsPayload.options,
          });
          responsePayload = credential;
        }

        const verifyResponse = await fetch('/api/auth/' + mode + '/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: responsePayload }),
        });
        const verifyPayload = await verifyResponse.json().catch(() => ({}));

        if (!verifyResponse.ok) {
          throw new Error(readErrorMessage(verifyPayload, 'Passkey verification failed.'));
        }

        state.auth.authenticated = true;
        state.auth.hasOwner = true;
        state.auth.loading = false;
        renderRoot();
        setStatus('Passkey verified.');
        await generateRandomMailbox();
      } catch (error) {
        state.auth.loading = false;
        renderAuthBox();
        window.alert(error && error.message ? error.message : 'Authentication failed.');
      }
    }

    async function checkAuth() {
      if (!state.auth.enabled) {
        state.auth.loading = false;
        renderRoot();
        await generateRandomMailbox();
        return;
      }

      state.auth.loading = true;
      renderRoot();

      try {
        const response = await fetch('/api/auth/status');
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(readErrorMessage(payload, 'Failed to load auth status.'));
        }

        state.auth.hasOwner = Boolean(payload.hasOwner);
        state.auth.authenticated = Boolean(payload.authenticated);
      } catch (error) {
        setStatus(error && error.message ? error.message : 'Failed to verify passkey session.', 'error');
      } finally {
        state.auth.loading = false;
        renderRoot();
      }

      if (state.auth.authenticated) {
        setStatus('Passkey session active.');
        await generateRandomMailbox();
      }
    }

    async function logout() {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
      }

      stopMailboxEffects();
      resetEmailSelection();
      state.showInbox = false;
      state.activeMailbox = '';
      state.activeLocalPart = '';
      state.activeDomain = '';
      state.emails = [];
      state.auth.authenticated = false;
      renderRoot();
    }

    function handleViewportChange(event) {
      state.isDesktop = event ? event.matches : mediaQuery.matches;
      if (state.isDesktop) {
        state.modalOpen = false;
        renderModal();
      }
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleViewportChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleViewportChange);
    }

    window.addEventListener('beforeunload', () => {
      stopMailboxEffects();
    }, { once: true });

    renderRoot();
    void checkAuth();
  `;
}

function buildHtml(config: HomePageConfig): string {
  const styles = buildStyles();
  const script = buildClientScript(config);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">
    <title>Temporary Mail Inbox</title>
    <style>${styles}</style>
  </head>
  <body>
    <div id="app" data-cloak="true" data-mail-domain="@${config.mailDomain}"></div>
    <script type="module">${script}</script>
  </body>
</html>`;
}

export function renderHomePage(
  mailDomain: string,
  mailDomainsOrOptions: string[] | HomePageOptions = {},
  maybeOptions: HomePageOptions = {}
) {
  const mailDomains = Array.isArray(mailDomainsOrOptions)
    ? (mailDomainsOrOptions.length > 0 ? mailDomainsOrOptions : [mailDomain])
    : [mailDomain];
  const options = Array.isArray(mailDomainsOrOptions) ? maybeOptions : mailDomainsOrOptions;

  return buildHtml({
    mailDomain,
    mailDomains,
    passkeyEnabled: Boolean(options.passkeyEnabled),
    mailboxLocalPartRegexSource: mailboxLocalPartPattern.source,
  });
}
