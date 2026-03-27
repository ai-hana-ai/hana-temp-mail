import{html as r,reactive as ce,watch as de}from"https://esm.sh/@arrow-js/core";import{startRegistration as me,startAuthentication as ue}from"https://esm.sh/@simplewebauthn/browser";function ve(q){let{mailDomain:A,availableMailDomains:I,passkeyEnabled:y,mailboxLocalPartRegexSource:O}=q,H=new RegExp(O),b=I[0]||A,w=document.getElementById("app");if(!w)throw new Error("Missing app root");let e=ce({localPart:"",selectedDomain:b,availableDomains:I,status:"Ready.",showInbox:!1,activeMailbox:"",emails:[],selected:null,selectedId:null,selectedIsHtml:!1,selectedPlainText:"",modalOpen:!1,isDesktopLayout:!1,isInboxLoading:!1,isEmailLoading:!1,eventSource:null,diceRolling:!1,skeletonItems:[1,2,3],activateInboxSeq:0,inboxLoadSeq:0,emailLoadSeq:0,htmlRenderSeq:0,inboxFetchController:null,auth:{enabled:y,hasOwner:!1,authenticated:!y,loading:y}}),C=()=>new Promise(t=>{requestAnimationFrame(()=>requestAnimationFrame(t))}),p=(t,a)=>!(typeof a=="number"&&a!==e.activateInboxSeq||t&&e.activeMailbox&&t!==e.activeMailbox),m=(t,a,i)=>{p(a,i)&&(e.status=t)},L=t=>{let a=(t||"").trim().toLowerCase();return!a||!H.test(a)?null:a},E=(t,a=e.selectedDomain||b)=>t+"@"+a,F=t=>{let a=(t||"").trim().toLowerCase();if(!a)return null;if(!a.includes("@")){let l=L(a);if(!l)return null;let d=e.selectedDomain||b;return{localPart:l,domain:d,mailbox:E(l,d)}}let i=a.split("@");if(i.length!==2)return null;let[s,c]=i,o=L(s),n=(c||"").trim().toLowerCase();return!o||!n||!e.availableDomains.includes(n)?null:{localPart:o,domain:n,mailbox:E(o,n)}},j=t=>t?typeof t!="string"||/Z$|[+-]\d\d:\d\d$/.test(t)?t:/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(t)?t.replace(" ","T")+"Z":t:"",P=t=>{let a=j(t),i=new Date(a);return Number.isNaN(i.getTime())?String(t||""):i.toLocaleString()},$=t=>(t||"").replace(/<!--[\s\S]*?-->/g," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim(),N=t=>{let a=(t?.body_text||"").trim();if(a)return a;let i=$(t?.body_html||"");return i||""},z=(t,a)=>{let i=(t?.body_html||"").trim();if(!i)return!1;let s=n=>(n||"").replace(/[\u00A0\u200B-\u200D\uFEFF]/g," ").replace(/\s+/g," ").trim().toLowerCase(),c=s($(i)),o=s(a||"");return!(!c||o&&c===o)},B=t=>{let a=(t?.preview||"").trim()||"No preview available";return a.length>120?a.slice(0,120)+"...":a},f=(t,a)=>t&&typeof t.error=="string"?t.error:t&&t.error&&typeof t.error.message=="string"?t.error.message:a,_=t=>{let i=new DOMParser().parseFromString(t||"","text/html");["script","iframe","object","embed","base","form","input","button","select","option","textarea","link","meta"].forEach(n=>{i.querySelectorAll(n).forEach(l=>l.remove())});let c=["http:","https:","mailto:","cid:","data:"],o=["href","src","poster","action","formaction"];return i.querySelectorAll("*").forEach(n=>{for(let l of Array.from(n.attributes)){let d=l.name.toLowerCase(),u=l.value.trim();if(d.startsWith("on")||d==="srcdoc"){n.removeAttribute(l.name);continue}if(d==="style"&&/expression|url\s*\(/i.test(u)){n.removeAttribute(l.name);continue}if(d==="target"){n.setAttribute("target","_blank");continue}if(o.includes(d)){if(!u)continue;try{let M=new URL(u,"https://mail.invalid");c.includes(M.protocol)||n.removeAttribute(l.name)}catch{n.removeAttribute(l.name)}}}n.tagName==="A"&&(n.setAttribute("rel","noopener noreferrer"),n.setAttribute("target","_blank"))}),i.body.innerHTML.trim()},U=t=>["<!DOCTYPE html>",'<html lang="en">',"<head>",'<meta charset="utf-8">',`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https: cid:; media-src data: http: https:; style-src 'unsafe-inline'; font-src data: http: https:; frame-src http: https:; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'">`,'<meta name="referrer" content="no-referrer">','<base target="_blank">',"<style>html,body{margin:0;padding:0;background:#fff;color:#111827}body{padding:16px;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}img{max-width:100%;height:auto}pre{white-space:pre-wrap;word-break:break-word}</style>","</head>","<body>",_(t)||'<p style="font-family: ui-sans-serif, system-ui, sans-serif; color: #475467;">HTML body was empty after sanitization.</p>',"</body>","</html>"].join(""),W=(t,a)=>{let i=document.getElementById(t);i&&i.setAttribute("srcdoc",U(a))},h=()=>{["email-html-frame-desktop","email-html-frame-mobile"].forEach(t=>{let a=document.getElementById(t);a&&a.removeAttribute("srcdoc")})},x=()=>{e.emailLoadSeq+=1,e.selected=null,e.selectedId=null,e.selectedIsHtml=!1,e.selectedPlainText="",e.isEmailLoading=!1,e.modalOpen=!1,h()},k=()=>{e.htmlRenderSeq+=1;let t=e.htmlRenderSeq;if(!e.selectedIsHtml||!e.selected){h();return}let a=e.selected.id,i=e.selected.body_html||"";h(),setTimeout(()=>{if(t!==e.htmlRenderSeq||!e.selectedIsHtml||!e.selected||e.selected.id!==a)return;let s=e.isDesktopLayout?"email-html-frame-desktop":"email-html-frame-mobile";W(s,i)},0)},T=()=>{e.isDesktopLayout=window.matchMedia("(min-width: 1024px)").matches,e.isDesktopLayout&&(e.modalOpen=!1),k()},G=(t=!1)=>{e.inboxLoadSeq+=1;let a=e.inboxLoadSeq;return e.isInboxLoading=!0,t||(x(),e.emails=[]),a},S=()=>{e.inboxFetchController&&(e.inboxFetchController.abort(),e.inboxFetchController=null)},g=async()=>{if(!e.diceRolling){e.diceRolling=!0;try{let t=e.selectedDomain||b,a=await fetch("/api/mailbox/random?domain="+encodeURIComponent(t)),i=await a.json();if(!a.ok)throw new Error(f(i,"Failed to generate random inbox."));let[s="",c=""]=String(i.mailbox||"").split("@");e.localPart=s,c&&e.availableDomains.includes(c)&&(e.selectedDomain=c)}catch(t){e.status=t instanceof Error?t.message:"Failed to generate random inbox."}finally{e.diceRolling=!1}}},J=async()=>{if(e.auth.enabled){e.auth.loading=!0;try{let t=await fetch("/api/auth/status"),a=await t.json();t.ok&&(e.auth.hasOwner=a.hasOwner,e.auth.authenticated=a.authenticated)}catch(t){console.error("Auth status check failed",t)}finally{e.auth.loading=!1}}},V=async()=>{e.auth.loading=!0;try{let t=await fetch("/api/auth/register/options",{method:"POST"}),a=await t.json();if(!t.ok)throw new Error(f(a,"Registration failed."));let i=await me({optionsJSON:a.options}),s=await fetch("/api/auth/register/verify",{method:"POST",body:JSON.stringify({response:i})});if(!s.ok){let c=await s.json();throw new Error(f(c,"Verification failed."))}e.auth.hasOwner=!0,e.auth.authenticated=!0,g()}catch(t){alert(t instanceof Error?t.message:"Passkey registration failed.")}finally{e.auth.loading=!1}},Y=async()=>{e.auth.loading=!0;try{let t=await fetch("/api/auth/login/options",{method:"POST"}),a=await t.json();if(!t.ok)throw new Error(f(a,"Login failed."));let i=await ue({optionsJSON:a.options}),s=await fetch("/api/auth/login/verify",{method:"POST",body:JSON.stringify({response:i})});if(!s.ok){let c=await s.json();throw new Error(f(c,"Verification failed."))}e.auth.authenticated=!0,g()}catch(t){alert(t instanceof Error?t.message:"Passkey login failed.")}finally{e.auth.loading=!1}},D=async(t={})=>{let a=typeof t?.mailbox=="string"&&t.mailbox?t.mailbox:e.activeMailbox,i=typeof t?.activateInboxSeq=="number"?t.activateInboxSeq:e.activateInboxSeq;if(!a){e.isInboxLoading=!1;return}if(e.auth.enabled&&!e.auth.authenticated){e.isInboxLoading=!1,m("Authentication required before loading "+a+".",a,i);return}let s=!!t?.preserveExisting;S();let c=G(s),o=new AbortController,n=!1,l=window.setTimeout(()=>{n=!0,o.abort()},12e3);e.inboxFetchController=o;try{m(s?"Refreshing messages for "+a+"...":"Loading inbox history for "+a+"...",a,i);let d=await fetch("/api/emails?to="+encodeURIComponent(a),{signal:o.signal}),u=await d.json().catch(()=>null);if(!d.ok)throw new Error(f(u,"Failed to load emails."));if(c!==e.inboxLoadSeq||!p(a,i))return;e.emails=Array.isArray(u)?u:[],e.selectedId&&(e.emails.find(re=>re.id===e.selectedId)||x()),m(e.emails.length>0?"Inbox ready for "+a+" ("+e.emails.length+" message(s)).":"Inbox ready for "+a+". Waiting for the first email...",a,i)}catch(d){if(c!==e.inboxLoadSeq||!p(a,i))return;let u=o.signal.aborted?n?"Loading "+a+" took too long. Please retry.":"Loading "+a+" was canceled.":d instanceof Error?d.message:"Failed to load emails.";throw u!=="Loading "+a+" was canceled."&&m(u,a,i),d}finally{window.clearTimeout(l),e.inboxFetchController===o&&(e.inboxFetchController=null),c===e.inboxLoadSeq&&(e.isInboxLoading=!1)}},v=()=>{e.eventSource&&(e.eventSource.close(),e.eventSource=null)},Z=(t,a)=>{if(!t)return;if(e.auth.enabled&&!e.auth.authenticated){m("Authentication required before realtime monitoring starts.",t,a);return}v();let i=new EventSource("/api/stream?to="+encodeURIComponent(t));e.eventSource=i,i.addEventListener("ready",()=>{e.eventSource!==i||!p(t,a)||m("Realtime connected for "+t+". Monitoring incoming mail...",t,a)}),i.addEventListener("update",()=>{e.eventSource!==i||!p(t,a)||(m("New activity detected for "+t+". Syncing inbox...",t,a),D({mailbox:t,preserveExisting:!0,activateInboxSeq:a}).catch(s=>{p(t,a)&&console.error("loadEmails from realtime update failed",s)}))}),i.onerror=()=>{e.eventSource===i&&(i.readyState===EventSource.CLOSED&&v(),m("Realtime connection interrupted for "+t+", reconnecting...",t,a))}},K=async()=>{try{let a=(document.getElementById("mailbox-local-part-input")?.value||e.localPart||"").trim();e.localPart=a;let i=F(a);if(!i){e.status="Enter an email name or a full mailbox for one of the configured domains.",alert("Please input an email name or full mailbox for a configured domain, e.g. john.doe or john.doe@adopsee.com");return}let{localPart:s,domain:c,mailbox:o}=i,n=e.showInbox&&e.activeMailbox===o,l=e.activateInboxSeq+1;e.activateInboxSeq=l,!a.includes("@")&&s&&(e.localPart=s),e.selectedDomain=c,v(),S(),m(n?"Refreshing workspace for "+o+"...":"Preparing inbox workspace for "+o+"...",void 0,l),n||(x(),e.emails=[]),e.activeMailbox=o,e.showInbox=!0,m(n?"Reusing inbox view for "+o+"...":"Switching inbox view to "+o+"...",o,l),await C(),m("Opening realtime stream for "+o+"...",o,l),Z(o,l),D({mailbox:o,preserveExisting:n,activateInboxSeq:l}).catch(d=>{p(o,l)&&console.error("activateInbox loadEmails failed",d)})}catch(t){v(),S(),e.status=t instanceof Error?t.message:"Failed to open inbox.",console.error("activateInbox failed",t)}},Q=async t=>{if(!e.activeMailbox)return;e.emailLoadSeq+=1;let a=e.emailLoadSeq;e.selectedId=t,e.modalOpen=!e.isDesktopLayout,e.isEmailLoading=!0,e.selected=null,e.selectedIsHtml=!1,e.selectedPlainText="",h();try{let i=await fetch("/api/email/"+t+"?to="+encodeURIComponent(e.activeMailbox)),s=await i.json();if(!i.ok)throw new Error(f(s,"Failed to load email."));if(a!==e.emailLoadSeq)return;e.selected=s,e.selectedId=s.id,e.selectedPlainText=N(s),e.selectedIsHtml=z(s,e.selectedPlainText),k()}catch(i){if(a!==e.emailLoadSeq)return;e.modalOpen=!1,e.selected=null,e.selectedId=null,e.selectedIsHtml=!1,e.selectedPlainText="",h(),alert(i instanceof Error?i.message:"Failed to load email.")}finally{a===e.emailLoadSeq&&(e.isEmailLoading=!1)}},R=()=>{e.modalOpen=!1,h()};de(()=>[e.selected?.id||"",e.selectedIsHtml,e.isDesktopLayout,e.modalOpen].join("|"),()=>{k()});let X=()=>r`
      <div class="empty-state empty-state-compact">
        <div class="empty-icon">✉️</div>
        <div class="empty-copy">
          <h3>Your inbox is empty</h3>
          <p>No emails have arrived at <b>${()=>e.activeMailbox||""}</b> yet. Share this address or wait a moment. The inbox refreshes automatically when new messages arrive.</p>
        </div>
      </div>
    `,ee=t=>r`
        <div
          class="${()=>{let a=["email-item"];return e.selectedId===t.id&&a.push("is-active"),e.isEmailLoading&&e.selectedId===t.id&&a.push("is-loading"),a.join(" ")}}"
          @click="${()=>Q(t.id)}"
        >
          <div class="email-row">
            <div class="subject">${t.subject||"(No Subject)"}</div>
            <span class="meta">${P(t.timestamp)}</span>
          </div>
          <div class="meta">${"From: "+t.id_from}</div>
          <div class="snippet">${B(t)}</div>
        </div>
      `.key(t.id),te=()=>r`
      <div class="stack-sm">
        ${()=>e.emails.map(t=>ee(t))}
      </div>
    `,ae=()=>r`
      <div class="inbox-body-content" .key="${()=>"inbox-body-"+(e.activeMailbox||"closed")+"-"+e.activateInboxSeq}">${()=>e.isInboxLoading&&e.emails.length===0?r`
            <div class="stack-sm">
              ${e.skeletonItems.map(t=>r`
                <div class="email-item email-skeleton" aria-hidden="true">
                  <div class="email-row">
                    <div class="skeleton-line skeleton-subject"></div>
                    <div class="skeleton-line skeleton-meta"></div>
                  </div>
                  <div class="skeleton-line skeleton-from"></div>
                  <div class="skeleton-line skeleton-snippet"></div>
                  <div class="skeleton-line skeleton-snippet short"></div>
                </div>
              `.key("email-skeleton-"+t))}
            </div>
          `:e.emails.length===0?X().key("inbox-body-"+(e.activeMailbox||"closed")+"-empty"):te().key("inbox-body-"+(e.activeMailbox||"closed")+"-list")}</div>
    `,ie=()=>e.showInbox?!e.selected&&!e.isEmailLoading?r`
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
          </div>`:e.isEmailLoading?r`
          <div class="detail-stage modal-skeleton detail-loading" aria-hidden="true">
            <div class="skeleton-line skeleton-heading"></div>
            <div class="skeleton-line skeleton-meta wide"></div>
            <div class="skeleton-block"></div>
            <div class="skeleton-line skeleton-snippet"></div>
            <div class="skeleton-line skeleton-snippet short"></div>
          </div>`:r`
        <div class="detail-stage detail-content">
          <div class="detail-head">
            <h2>${()=>e.selected?.subject||"(No Subject)"}</h2>
            <p class="meta">${()=>e.selected?"From: "+e.selected.id_from+" | To: "+e.selected.id_to:""}</p>
            <p class="meta">${()=>e.selected?P(e.selected.timestamp):""}</p>
          </div>
          <hr class="detail-divider" />
          ${()=>e.selectedIsHtml?r`<iframe id="email-html-frame-desktop" class="email-html-frame" sandbox="allow-popups" referrerpolicy="no-referrer"></iframe>`:r`<pre class="text-body">${()=>e.selectedPlainText||"(No message body)"}</pre>`}
        </div>`:r`
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
          </div>`,se=()=>e.isEmailLoading?r`
          <div class="modal-skeleton" aria-hidden="true">
            <div class="skeleton-line skeleton-heading"></div>
            <div class="skeleton-line skeleton-meta wide"></div>
            <div class="skeleton-block"></div>
            <div class="skeleton-line skeleton-snippet"></div>
            <div class="skeleton-line skeleton-snippet short"></div>
          </div>`:e.selected&&e.selectedIsHtml?r`<iframe id="email-html-frame-mobile" class="email-html-frame" sandbox="allow-popups" referrerpolicy="no-referrer"></iframe>`:e.selected?r`<pre class="text-body">${()=>e.selectedPlainText||"(No message body)"}</pre>`:"",oe=()=>e.auth.loading?r`<div class="detail-empty"><h3>Checking security...</h3></div>`:e.auth.hasOwner?r`
         <div class="detail-empty detail-welcome">
           <div class="detail-empty-art"><div class="empty-icon">🔑</div></div>
           <div class="empty-copy">
             <span class="detail-empty-kicker">Restricted Access</span>
             <h3>Owner Authentication Required</h3>
             <p>Please verify your identity to access the mailbox workspace.</p>
             <br/>
             <button @click="${Y}">Login with Passkey</button>
           </div>
         </div>`:r`
           <div class="detail-empty detail-welcome">
             <div class="detail-empty-art"><div class="empty-icon">🔐</div></div>
             <div class="empty-copy">
               <span class="detail-empty-kicker">Secure Application</span>
               <h3>Setup Application Owner</h3>
               <p>This application is restricted. Please register your passkey to become the owner of this workspace.</p>
               <br/>
               <button @click="${V}">Create Owner Passkey</button>
             </div>
           </div>`;r`
      ${()=>e.auth.enabled&&!e.auth.authenticated?oe():r`
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
                      value="${e.localPart}"
                      @input="${t=>{e.localPart=t.target.value}}"
                    />
                    <div class="domain-select-wrap">
                      <span class="domain-at">@</span>
                      <select 
                        class="domain-select"
                        .value="${()=>e.selectedDomain}"
                        @change="${t=>{e.selectedDomain=t.target.value}}"
                      >
                        ${()=>e.availableDomains.map(t=>r`
                          <option value="${t}">${t}</option>
                        `)}
                      </select>
                    </div>
                    <button
                      class="${()=>e.diceRolling?"dice-btn is-rolling":"dice-btn"}"
                      ?disabled="${()=>e.diceRolling}"
                      @click="${t=>{t.preventDefault(),g()}}"
                      title="Generate random inbox"
                    >🎲</button>
                  </div>
                  <button style="display:block;width:100%;" @click="${()=>K()}">Open Inbox</button>
                </div>
                <div class="status">${()=>e.status}</div>
              </div>

              ${()=>e.showInbox?r`
                <div class="email-list-wrap card" id="email-list">
                  <div class="inbox-head">
                    <span>Inbox: <b>${()=>e.activeMailbox}</b></span>
                    <span>${()=>e.emails.length+" message(s)"}</span>
                  </div>
                  <div class="email-list-body">${()=>ae()}</div>
                </div>
              `:""}
            </aside>

            <section class="detail-panel">${()=>ie()}</section>
          </div>

          <div class="footer">
            Built for Cloudflare Workers · <a href="https://github.com/ai-hana-ai/hana-temp-mail" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
          </div>

          <div
            class="${()=>e.modalOpen&&!e.isDesktopLayout?"modal show":"modal"}"
            @click="${()=>R()}"
          >
            <div class="modal-content" @click="${t=>t.stopPropagation()}">
              <h2>${()=>e.selected?.subject||"(No Subject)"}</h2>
              <p class="meta">${()=>e.selected?"From: "+e.selected.id_from+" | To: "+e.selected.id_to:""}</p>
              <hr class="detail-divider" />
              ${()=>se()}
              <br />
              <button style="display:block;width:100%;" @click="${()=>R()}">Close</button>
            </div>
          </div>
        `}
    `(w),T(),w.removeAttribute("data-cloak");let ne=()=>v(),le=()=>T();window.addEventListener("beforeunload",ne),window.addEventListener("resize",le),e.auth.enabled?J():g()}export{ve as initApp};
