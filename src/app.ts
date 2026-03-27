import { html, reactive, watch } from 'https://esm.sh/@arrow-js/core';
import { 
  startRegistration, 
  startAuthentication 
} from 'https://esm.sh/@simplewebauthn/browser';

/**
 * REWRITTEN FRONTEND LOGIC v3.0 (Clean State & Robust Transitions)
 */
export function initApp(config: any) {
    const { mailDomain, availableMailDomains, passkeyEnabled, mailboxLocalPartRegexSource } = config;
    const mailboxLocalPartPattern = new RegExp(mailboxLocalPartRegexSource);
    const defaultMailDomain = availableMailDomains[0] || mailDomain;
    const root = document.getElementById('app');

    if (!root) throw new Error('Missing app root');

    // --- 1. Reactive State ---
    const state = reactive({
      // Input & Config
      inputText: '',
      selectedDomain: defaultMailDomain,
      availableDomains: availableMailDomains,
      
      // App State
      status: 'Ready.',
      showInbox: false,
      activeMailbox: '', // THE source of truth for what's currently being viewed
      
      // Data
      emails: [] as any[],
      selectedEmail: null as any,
      isInboxLoading: false,
      isEmailLoading: false,
      
      // UI Helpers
      diceRolling: false,
      modalOpen: false,
      isDesktop: window.matchMedia('(min-width: 1024px)').matches,
      
      // Internal Controllers
      sse: null as EventSource | null,
      fetchController: null as AbortController | null,

      // Auth
      auth: {
        enabled: passkeyEnabled,
        hasOwner: false,
        authenticated: !passkeyEnabled,
        loading: passkeyEnabled
      }
    });

    // --- 2. Internal Helpers ---

    const updateStatus = (msg: string) => { state.status = msg; };

    const stopEverything = () => {
        // Stop SSE
        if (state.sse) {
            state.sse.close();
            state.sse = null;
        }
        // Abort Fetch
        if (state.fetchController) {
            state.fetchController.abort();
            state.fetchController = null;
        }
        // Reset View State
        state.isInboxLoading = false;
        state.isEmailLoading = false;
        state.selectedEmail = null;
        state.modalOpen = false;
    };

    const normalizeInput = (val: string) => {
        const v = (val || '').trim().toLowerCase();
        if (!v) return null;

        if (v.includes('@')) {
            const [local, dom] = v.split('@');
            if (availableMailDomains.includes(dom) && mailboxLocalPartPattern.test(local)) {
                return { local, dom, full: v };
            }
            return null;
        }

        if (mailboxLocalPartPattern.test(v)) {
            const dom = state.selectedDomain || defaultMailDomain;
            return { local: v, dom, full: `${v}@${dom}` };
        }
        return null;
    };

    // --- 3. Core Actions ---

    const loadInbox = async (mailbox: string, isRefresh = false) => {
        if (state.fetchController) state.fetchController.abort();
        
        const controller = new AbortController();
        state.fetchController = controller;
        state.isInboxLoading = !isRefresh; // Only show skeleton on first load

        try {
            updateStatus(`Loading ${mailbox}...`);
            const res = await fetch(`/api/emails?to=${encodeURIComponent(mailbox)}`, { signal: controller.signal });
            if (!res.ok) throw new Error('Failed to fetch emails');
            
            const data = await res.json();
            // Critical check: only update if this is still the active mailbox
            if (state.activeMailbox === mailbox) {
                state.emails = Array.isArray(data) ? data : [];
                updateStatus(state.emails.length > 0 ? `Inbox ready (${state.emails.length} messages)` : 'Waiting for emails...');
            }
        } catch (e: any) {
            if (e.name === 'AbortError') return;
            updateStatus(`Error: ${e.message}`);
        } finally {
            if (state.activeMailbox === mailbox) {
                state.isInboxLoading = false;
                state.fetchController = null;
            }
        }
    };

    const connectSSE = (mailbox: string) => {
        if (state.sse) state.sse.close();
        
        const sse = new EventSource(`/api/stream?to=${encodeURIComponent(mailbox)}`);
        state.sse = sse;

        sse.addEventListener('ready', () => {
            if (state.activeMailbox === mailbox) updateStatus(`Live monitoring active.`);
        });

        sse.addEventListener('update', () => {
            if (state.activeMailbox === mailbox) loadInbox(mailbox, true);
        });

        sse.onerror = () => {
            if (state.activeMailbox === mailbox) updateStatus('Connection lost, retrying...');
        };
    };

    const activateInbox = async () => {
        // 1. Force read from DOM to bypass reactivity lag
        const inputEl = document.getElementById('mailbox-local-part-input') as HTMLInputElement;
        const rawInput = inputEl?.value || state.inputText;
        
        const parsed = normalizeInput(rawInput);
        if (!parsed) {
            alert('Invalid email name or domain.');
            return;
        }

        // 2. Clear old state immediately
        stopEverything();
        
        // 3. Set new active state
        state.activeMailbox = parsed.full;
        state.inputText = parsed.local;
        state.selectedDomain = parsed.dom;
        state.showInbox = true;
        state.emails = [];

        // 4. Trigger background work
        connectSSE(parsed.full);
        await loadInbox(parsed.full);
    };

    const generateRandom = async () => {
        if (state.diceRolling) return;
        state.diceRolling = true;
        try {
            const dom = state.selectedDomain || defaultMailDomain;
            const res = await fetch(`/api/mailbox/random?domain=${encodeURIComponent(dom)}`);
            const data = await res.json();
            if (data.mailbox) {
                state.inputText = data.mailbox.split('@')[0];
            }
        } catch (e) {
            updateStatus('Failed to generate random.');
        } finally {
            state.diceRolling = false;
        }
    };

    const viewEmail = async (email: any) => {
        state.isEmailLoading = true;
        state.selectedEmail = null;
        state.modalOpen = !state.isDesktop;

        try {
            const res = await fetch(`/api/email/${email.id}?to=${encodeURIComponent(state.activeMailbox)}`);
            const data = await res.json();
            if (res.ok) {
                state.selectedEmail = data;
            } else {
                alert('Failed to load email body.');
            }
        } catch (e) {
            alert('Error loading email.');
        } finally {
            state.isEmailLoading = false;
        }
    };

    // --- 4. Auth Logic ---
    const checkAuth = async () => {
        if (!state.auth.enabled) return;
        state.auth.loading = true;
        try {
            const res = await fetch('/api/auth/status');
            const data = await res.json();
            state.auth.hasOwner = data.hasOwner;
            state.auth.authenticated = data.authenticated;
            if (data.authenticated) generateRandom();
        } catch (e) {
            console.error('Auth check failed');
        } finally {
            state.auth.loading = false;
        }
    };

    const handleAuth = async (mode: 'login' | 'register') => {
        state.auth.loading = true;
        try {
            const resOptions = await fetch(`/api/auth/${mode}/options`, { method: 'POST' });
            const opt = await resOptions.json();
            if (!resOptions.ok) throw new Error(opt.error || `${mode} failed`);

            const cred = mode === 'register' 
                ? await startRegistration({ optionsJSON: opt.options })
                : await startAuthentication({ optionsJSON: opt.options });

            const resVerify = await fetch(`/api/auth/${mode}/verify`, {
                method: 'POST',
                body: JSON.stringify({ response: cred })
            });
            if (!resVerify.ok) throw new Error('Verification failed');
            
            state.auth.authenticated = true;
            generateRandom();
        } catch (e: any) {
            alert(e.message);
        } finally {
            state.auth.loading = false;
        }
    };

    // --- 5. Templates ---

    const skeletonTpl = () => html`
        <div class="stack-sm">
            ${[1, 2, 3].map(() => html`
                <div class="email-item email-skeleton">
                    <div class="skeleton-line skeleton-subject"></div>
                    <div class="skeleton-line skeleton-from"></div>
                    <div class="skeleton-line skeleton-snippet"></div>
                </div>
            `)}
        </div>
    `;

    const emailListTpl = () => {
        if (state.isInboxLoading) return skeletonTpl();
        if (state.emails.length === 0) return html`
            <div class="empty-state-compact">
                <p>No emails at <b>${state.activeMailbox}</b> yet.</p>
            </div>
        `;

        return html`
            <div class="stack-sm">
                ${state.emails.map(email => html`
                    <div class="email-item ${state.selectedEmail?.id === email.id ? 'is-active' : ''}" @click="${() => viewEmail(email)}">
                        <div class="email-row">
                            <div class="subject">${email.subject || '(No Subject)'}</div>
                            <span class="meta">${new Date(email.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div class="meta">From: ${email.id_from}</div>
                        <div class="snippet">${email.preview}</div>
                    </div>
                `.key(email.id))}
            </div>
        `;
    };

    const detailTpl = () => {
        if (!state.showInbox) return html`<div class="detail-empty"><h3>Welcome to Hana Mail</h3><p>Pick a mailbox to start.</p></div>`;
        if (state.isEmailLoading) return html`<div class="detail-loading"><div class="skeleton-block"></div></div>`;
        if (!state.selectedEmail) return html`<div class="detail-empty"><h3>📭 Select an email</h3></div>`;

        const email = state.selectedEmail;
        return html`
            <div class="detail-content">
                <div class="detail-head">
                    <h2>${email.subject}</h2>
                    <p class="meta">From: ${email.id_from}</p>
                </div>
                <hr class="detail-divider" />
                ${email.body_html 
                    ? html`<iframe class="email-html-frame" .srcdoc="${email.body_html}" sandbox="allow-popups"></iframe>`
                    : html`<pre class="text-body">${email.body_text}</pre>`
                }
            </div>
        `;
    };

    const authScreenTpl = () => {
        if (state.auth.loading) return html`<div class="detail-empty"><h3>Verifying...</h3></div>`;
        if (!state.auth.hasOwner) return html`
            <div class="detail-empty detail-welcome">
                <div class="empty-icon">🔐</div>
                <h3>Setup Owner</h3>
                <p>Register your passkey to start.</p>
                <button @click="${() => handleAuth('register')}">Create Passkey</button>
            </div>
        `;
        return html`
            <div class="detail-empty detail-welcome">
                <div class="empty-icon">🔑</div>
                <h3>Owner Required</h3>
                <button @click="${() => handleAuth('login')}">Login with Passkey</button>
            </div>
        `;
    };

    // --- 6. Main App Template ---
    const appTpl = html`
        ${() => (state.auth.enabled && !state.auth.authenticated) ? authScreenTpl() : html`
            <div class="hero">
                <div class="hero-badge">🌸 Hana Mail</div>
                <h1>Temporary Mail</h1>
            </div>

            <div class="page-main">
                <aside class="sidebar">
                    <div class="card">
                        <div class="selector">
                            <div class="input-wrap multi-domain">
                                <input id="mailbox-local-part-input" type="text" placeholder="name" 
                                    .value="${() => state.inputText}"
                                    @input="${(e: any) => state.inputText = e.target.value}" />
                                <div class="domain-select-wrap">
                                    <span class="domain-at">@</span>
                                    <select class="domain-select" .value="${() => state.selectedDomain}" 
                                        @change="${(e: any) => state.selectedDomain = e.target.value}">
                                        ${state.availableDomains.map(d => html`<option value="${d}">${d}</option>`)}
                                    </select>
                                </div>
                                <button class="dice-btn ${state.diceRolling ? 'is-rolling' : ''}" @click="${generateRandom}">🎲</button>
                            </div>
                            <button style="width:100%" @click="${activateInbox}">Open Inbox</button>
                        </div>
                        <div class="status">${() => state.status}</div>
                    </div>

                    ${() => state.showInbox ? html`
                        <div class="email-list-wrap card">
                            <div class="inbox-head"><b>${() => state.activeMailbox}</b></div>
                            <div class="email-list-body">${() => emailListTpl()}</div>
                        </div>
                    ` : ''}
                </aside>

                <section class="detail-panel">${() => detailTpl()}</section>
            </div>

            <div class="modal ${state.modalOpen ? 'show' : ''}" @click="${() => state.modalOpen = false}">
                <div class="modal-content" @click="${(e: any) => e.stopPropagation()}">
                    ${() => detailTpl()}
                    <button style="width:100%; margin-top: 1rem" @click="${() => state.modalOpen = false}">Close</button>
                </div>
            </div>
        `}
    `;

    // --- 7. Lifecycle ---
    appTpl(root);
    window.addEventListener('resize', () => { state.isDesktop = window.matchMedia('(min-width: 1024px)').matches; });
    checkAuth();
    if (!state.auth.enabled) generateRandom();
}
