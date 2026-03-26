# Temporary Inbox Worker (Cloudflare)

A temporary email inbox app built on **Cloudflare Workers** with:

- **Hono** (routing/API)
- **Arrow-JS (`@arrow-js/core`)** via `esm.sh` (frontend reactivity and templating)
- **Cloudflare D1** (email storage)
- **Cloudflare Email Routing** (inbound email capture)
- **SSE** (real-time inbox updates)
- **Passkey authentication** (optional, via WebAuthn/SimpleWebAuthn)
- **Multi-domain support** (serve multiple mail domains from a single worker)

## Features

- Generate random inbox local-part (🎲)
- Multi-domain support with dropdown selector (`MAIL_DOMAINS`)
- Optional passkey (WebAuthn) authentication to restrict access
- Inbox appears only after user submits selected local-part
- Real-time updates via SSE (`/api/stream`)
- Email detail modal with sanitized HTML rendering (iframe) and text fallback
- Metadata-only inbox list responses with precomputed previews
- Automatic retention metadata plus scheduled cleanup support
- CSP-friendly client runtime with no `unsafe-eval` requirement

---

## Requirements

- Node.js 18+
- pnpm
- Cloudflare account
- A domain managed in Cloudflare (for Email Routing)

---

## 1) Install

```bash
pnpm install
```

## 2) Create D1 Database

```bash
pnpm wrangler d1 create <your-db-name>
```

Then copy the returned `database_id` into a local deployment config or replace the placeholder values in `wrangler.toml` for your environment:

```toml
[[d1_databases]]
binding = "DB"
database_name = "<your-db-name>"
database_id = "<your-database-id>"
```

Apply schema:

```bash
pnpm wrangler d1 execute <your-db-name> --file=schema.sql
```

## 3) Configure Environment

Set your inbox domain(s) in Cloudflare dashboard vars, `.dev.vars`, or `wrangler.toml`:

```toml
[vars]
MAIL_DOMAINS = "example.com,mail.example.org"
ENABLE_PASSKEY = "true"
```

- **`MAIL_DOMAINS`** — comma-separated list of accepted mail domains. The first domain is the primary/default. Users can pick any configured domain from a dropdown in the UI.
- **`ENABLE_PASSKEY`** — set to `"true"` to require passkey (WebAuthn) authentication before accessing the inbox. When enabled, a passkey owner must be registered first, and all subsequent visitors must authenticate. When disabled or absent, the inbox is fully public.

> The UI only accepts local-part input (e.g. `alice`), and the app appends `@<selected-domain>` automatically.
> Public API requests are rate-limited on a best-effort basis per client IP.

Optional environment variables:

- `RETENTION_DAYS` defaults to `7`
- `RATE_LIMIT_WINDOW_MS` defaults to `60000`

### Passkey Authentication (Optional)

When `ENABLE_PASSKEY` is set to `"true"`:

1. The first visitor can **register as the owner** by creating a passkey.
2. After the owner is registered, all visitors must **authenticate with a passkey** to access the inbox workspace.
3. Passkey credentials are stored in D1 alongside email data.
4. Authentication uses the [SimpleWebAuthn](https://simplewebauthn.dev/) library (server + browser).

This is useful when you want to keep your temporary inbox private — only you (the passkey owner) can view incoming emails. Set `ENABLE_PASSKEY` to `"false"` or remove it entirely for a fully public inbox.

## 4) Run Locally

```bash
pnpm wrangler dev
```

## 5) Deploy

```bash
pnpm wrangler deploy
```

If you keep `wrangler.toml` sanitized for reuse, create a local override file with your real D1 binding and vars, then deploy with:

```bash
pnpm wrangler deploy --config wrangler.local.toml
```

---

## 6) Configure Cloudflare Email Routing (Required)

Without this, emails will bounce even if the Worker is deployed.

1. Open Cloudflare Dashboard for your domain (`MAIL_DOMAIN`)
2. Go to **Email → Email Routing**
3. Ensure Email Routing is enabled
4. In **Routes**, create/update a catch-all rule:
   - **Matcher:** `all`
   - **Action:** `Send to Worker`
   - **Worker:** your deployed worker name (e.g. `hana-temp-mail`)
   - **Enabled:** `ON`
5. Save changes

Also ensure DNS records for your domain are valid:
- **MX** records exist and point to Cloudflare Email Routing targets
- **A/AAAA** for apex domain resolve properly

---

## API Endpoints

- `GET /api/mailbox/random` — returns `{ mailbox, domains }`
- `GET /api/emails?to=<mailbox>`
- `GET /api/email/:id?to=<mailbox>`
- `GET /api/stream?to=<mailbox>`
- `GET /api/auth/status` — returns passkey auth state (when enabled)
- `POST /api/auth/register/options` — get WebAuthn registration options
- `POST /api/auth/register/verify` — verify registration response
- `POST /api/auth/login/options` — get WebAuthn login options
- `POST /api/auth/login/verify` — verify login response

`GET /api/emails` returns inbox metadata only: `id`, `id_from`, `subject`, `timestamp`, and `preview`.

---

## How It Works

1. User enters local-part (e.g. `support`) and selects a domain from the dropdown
2. App builds mailbox as `support@<selected-domain>`
3. SSE subscribes to that mailbox
4. Incoming emails are parsed and stored in D1
5. Inbox updates in real-time
6. Expired emails can be removed by the scheduled cleanup trigger

## Retention

The default retention window is 7 days. Each email stores an `expires_at` timestamp, and the Worker exposes an hourly scheduled cleanup hook (`wrangler` cron) that deletes expired rows.

Apply the included migration before deploying this version to an existing database:

```bash
pnpm wrangler d1 execute <your-db-name> --file=./migrations/0001_preview_retention.sql --remote
```

---

## Troubleshooting

### Emails bounce with "domain does not exist" / "address not found"
- Verify `MAIL_DOMAINS` contains your domain(s)
- Verify Email Routing route is enabled and points to your Worker
- Verify MX + A/AAAA DNS records are present and propagated

### UI loads but inbox never receives emails
- Confirm route action is **Send to Worker** (not forward/drop)
- Confirm inbound mailbox domain matches one of the domains in `MAIL_DOMAINS`
- Check Worker logs with:

```bash
pnpm wrangler tail
```

### HTML email not displayed as expected
- Some providers send text-only bodies; app falls back to plain text automatically.

## Frontend Notes

- The homepage HTML is server-rendered by Hono from `src/ui.tsx`.
- Client-side interactivity is mounted with Arrow-JS templates and `reactive()` state.
- The page imports Arrow-JS from `https://esm.sh/@arrow-js/core`.
- The main page CSP allows inline modules plus `esm.sh`, but does not require `unsafe-eval`.
