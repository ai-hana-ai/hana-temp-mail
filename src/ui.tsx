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
  
  // Script will be bundled by esbuild and injected/linked
  const initScript = `
    import { initApp } from '/app.js';
    initApp({
      mailDomain: ${JSON.stringify(mailDomain)},
      availableMailDomains: ${JSON.stringify(mailDomains)},
      passkeyEnabled: ${JSON.stringify(passkeyEnabled)},
      mailboxLocalPartRegexSource: ${JSON.stringify(mailboxLocalPartRegexSource)}
    });
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
      box-shadow:inset 0 1px 0 rgba(255,255,255,.8), 0 10px 24px rgba(109,94,252,12);
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
        <script type="module" dangerouslySetInnerHTML={{ __html: initScript }} />
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
