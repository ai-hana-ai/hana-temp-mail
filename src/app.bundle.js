import{html as s,reactive as C}from"https://esm.sh/@arrow-js/core";import{startRegistration as T,startAuthentication as R}from"https://esm.sh/@simplewebauthn/browser";function P(b){let{mailDomain:g,availableMailDomains:c,passkeyEnabled:r,mailboxLocalPartRegexSource:y}=b,u=new RegExp(y),d=c[0]||g,p=document.getElementById("app");if(!p)throw new Error("Missing app root");let e=C({inputText:"",selectedDomain:d,availableDomains:c,status:"Ready.",showInbox:!1,activeMailbox:"",emails:[],selectedEmail:null,isInboxLoading:!1,isEmailLoading:!1,diceRolling:!1,modalOpen:!1,isDesktop:window.matchMedia("(min-width: 1024px)").matches,sse:null,fetchController:null,auth:{enabled:r,hasOwner:!1,authenticated:!r,loading:r}}),n=t=>{e.status=t},w=()=>{e.sse&&(e.sse.close(),e.sse=null),e.fetchController&&(e.fetchController.abort(),e.fetchController=null),e.isInboxLoading=!1,e.isEmailLoading=!1,e.selectedEmail=null,e.modalOpen=!1},$=t=>{let a=(t||"").trim().toLowerCase();if(!a)return null;if(a.includes("@")){let[i,l]=a.split("@");return c.includes(l)&&u.test(i)?{local:i,dom:l,full:a}:null}if(u.test(a)){let i=e.selectedDomain||d;return{local:a,dom:i,full:`${a}@${i}`}}return null},v=async(t,a=!1)=>{e.fetchController&&e.fetchController.abort();let i=new AbortController;e.fetchController=i,e.isInboxLoading=!a;try{n(`Loading ${t}...`);let l=await fetch(`/api/emails?to=${encodeURIComponent(t)}`,{signal:i.signal});if(!l.ok)throw new Error("Failed to fetch emails");let m=await l.json();e.activeMailbox===t&&(e.emails=Array.isArray(m)?m:[],n(e.emails.length>0?`Inbox ready (${e.emails.length} messages)`:"Waiting for emails..."))}catch(l){if(l.name==="AbortError")return;n(`Error: ${l.message}`)}finally{e.activeMailbox===t&&(e.isInboxLoading=!1,e.fetchController=null)}},x=t=>{e.sse&&e.sse.close();let a=new EventSource(`/api/stream?to=${encodeURIComponent(t)}`);e.sse=a,a.addEventListener("ready",()=>{e.activeMailbox===t&&n("Live monitoring active.")}),a.addEventListener("update",()=>{e.activeMailbox===t&&v(t,!0)}),a.onerror=()=>{e.activeMailbox===t&&n("Connection lost, retrying...")}},k=async()=>{let a=document.getElementById("mailbox-local-part-input")?.value||e.inputText,i=$(a);if(!i){alert("Invalid email name or domain.");return}w(),e.activeMailbox=i.full,e.inputText=i.local,e.selectedDomain=i.dom,e.showInbox=!0,e.emails=[],x(i.full),await v(i.full)},o=async()=>{if(!e.diceRolling){e.diceRolling=!0;try{let t=e.selectedDomain||d,i=await(await fetch(`/api/mailbox/random?domain=${encodeURIComponent(t)}`)).json();i.mailbox&&(e.inputText=i.mailbox.split("@")[0])}catch{n("Failed to generate random.")}finally{e.diceRolling=!1}}},E=async t=>{e.isEmailLoading=!0,e.selectedEmail=null,e.modalOpen=!e.isDesktop;try{let a=await fetch(`/api/email/${t.id}?to=${encodeURIComponent(e.activeMailbox)}`),i=await a.json();a.ok?e.selectedEmail=i:alert("Failed to load email body.")}catch{alert("Error loading email.")}finally{e.isEmailLoading=!1}},I=async()=>{if(e.auth.enabled){e.auth.loading=!0;try{let a=await(await fetch("/api/auth/status")).json();e.auth.hasOwner=a.hasOwner,e.auth.authenticated=a.authenticated,a.authenticated&&o()}catch{console.error("Auth check failed")}finally{e.auth.loading=!1}}},h=async t=>{e.auth.loading=!0;try{let a=await fetch(`/api/auth/${t}/options`,{method:"POST"}),i=await a.json();if(!a.ok)throw new Error(i.error||`${t} failed`);let l=t==="register"?await T({optionsJSON:i.options}):await R({optionsJSON:i.options});if(!(await fetch(`/api/auth/${t}/verify`,{method:"POST",body:JSON.stringify({response:l})})).ok)throw new Error("Verification failed");e.auth.authenticated=!0,o()}catch(a){alert(a.message)}finally{e.auth.loading=!1}},L=()=>s`
        <div class="stack-sm">
            ${[1,2,3].map(()=>s`
                <div class="email-item email-skeleton">
                    <div class="skeleton-line skeleton-subject"></div>
                    <div class="skeleton-line skeleton-from"></div>
                    <div class="skeleton-line skeleton-snippet"></div>
                </div>
            `)}
        </div>
    `,M=()=>e.isInboxLoading?L():e.emails.length===0?s`
            <div class="empty-state-compact">
                <p>No emails at <b>${e.activeMailbox}</b> yet.</p>
            </div>
        `:s`
            <div class="stack-sm">
                ${e.emails.map(t=>s`
                    <div class="email-item ${e.selectedEmail?.id===t.id?"is-active":""}" @click="${()=>E(t)}">
                        <div class="email-row">
                            <div class="subject">${t.subject||"(No Subject)"}</div>
                            <span class="meta">${new Date(t.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div class="meta">From: ${t.id_from}</div>
                        <div class="snippet">${t.preview}</div>
                    </div>
                `.key(t.id))}
            </div>
        `,f=()=>{if(!e.showInbox)return s`<div class="detail-empty"><h3>Welcome to Hana Mail</h3><p>Pick a mailbox to start.</p></div>`;if(e.isEmailLoading)return s`<div class="detail-loading"><div class="skeleton-block"></div></div>`;if(!e.selectedEmail)return s`<div class="detail-empty"><h3>📭 Select an email</h3></div>`;let t=e.selectedEmail;return s`
            <div class="detail-content">
                <div class="detail-head">
                    <h2>${t.subject}</h2>
                    <p class="meta">From: ${t.id_from}</p>
                </div>
                <hr class="detail-divider" />
                ${t.body_html?s`<iframe class="email-html-frame" .srcdoc="${t.body_html}" sandbox="allow-popups"></iframe>`:s`<pre class="text-body">${t.body_text}</pre>`}
            </div>
        `},O=()=>e.auth.loading?s`<div class="detail-empty"><h3>Verifying...</h3></div>`:e.auth.hasOwner?s`
            <div class="detail-empty detail-welcome">
                <div class="empty-icon">🔑</div>
                <h3>Owner Required</h3>
                <button @click="${()=>h("login")}">Login with Passkey</button>
            </div>
        `:s`
            <div class="detail-empty detail-welcome">
                <div class="empty-icon">🔐</div>
                <h3>Setup Owner</h3>
                <p>Register your passkey to start.</p>
                <button @click="${()=>h("register")}">Create Passkey</button>
            </div>
        `;s`
        ${()=>e.auth.enabled&&!e.auth.authenticated?O():s`
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
                                    .value="${()=>e.inputText}"
                                    @input="${t=>e.inputText=t.target.value}" />
                                <div class="domain-select-wrap">
                                    <span class="domain-at">@</span>
                                    <select class="domain-select" .value="${()=>e.selectedDomain}" 
                                        @change="${t=>e.selectedDomain=t.target.value}">
                                        ${e.availableDomains.map(t=>s`<option value="${t}">${t}</option>`)}
                                    </select>
                                </div>
                                <button class="dice-btn ${e.diceRolling?"is-rolling":""}" @click="${o}">🎲</button>
                            </div>
                            <button style="width:100%" @click="${k}">Open Inbox</button>
                        </div>
                        <div class="status">${()=>e.status}</div>
                    </div>

                    ${()=>e.showInbox?s`
                        <div class="email-list-wrap card">
                            <div class="inbox-head"><b>${()=>e.activeMailbox}</b></div>
                            <div class="email-list-body">${()=>M()}</div>
                        </div>
                    `:""}
                </aside>

                <section class="detail-panel">${()=>f()}</section>
            </div>

            <div class="modal ${e.modalOpen?"show":""}" @click="${()=>e.modalOpen=!1}">
                <div class="modal-content" @click="${t=>t.stopPropagation()}">
                    ${()=>f()}
                    <button style="width:100%; margin-top: 1rem" @click="${()=>e.modalOpen=!1}">Close</button>
                </div>
            </div>
        `}
    `(p),window.addEventListener("resize",()=>{e.isDesktop=window.matchMedia("(min-width: 1024px)").matches}),I(),e.auth.enabled||o()}export{P as initApp};
