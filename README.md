# Adopsee Temporary Inbox

Temporary email inbox built on **Cloudflare Workers** with:

- **Hono** (routing/API)
- **Alpine.js** (frontend state)
- **Cloudflare D1** (email storage)
- **Cloudflare Email Routing** (inbound email capture)
- **SSE** (real-time inbox updates)

## Features

- Generate random inbox local-part (🎲)
- Fixed domain from environment variable (`MAIL_DOMAIN`)
- Inbox appears only after user submits selected local-part
- Real-time updates using Server-Sent Events (`/api/stream`)
- Email detail modal with HTML rendering (iframe) and text fallback

## Environment

Configured in `wrangler.toml`:

```toml
[vars]
MAIL_DOMAIN = "adopsee.com"
```

D1 binding:

```toml
[[d1_databases]]
binding = "DB"
database_name = "temp-mail-db"
```

## Local Development

```bash
pnpm install
pnpm wrangler dev
```

## Deploy

```bash
pnpm wrangler deploy
```

## Cloudflare Email Routing Setup (Required)

To receive incoming emails (e.g. `hana@adopsee.com`) you must configure Email Routing to your Worker.

1. Open Cloudflare Dashboard for `adopsee.com`
2. Go to **Email → Email Routing**
3. In **Routes**, create/update a catch-all rule:
   - **Matcher:** `all`
   - **Action:** `Send to Worker`
   - **Worker:** `hana-temp-mail`
   - **Enabled:** `ON`
4. Save changes

Also ensure DNS has valid records for domain resolution and mail delivery:
- MX: `route1/2/3.mx.cloudflare.net`
- A/AAAA: resolvable for `adopsee.com`

## API Endpoints

- `GET /api/mailbox/random`
- `GET /api/emails?to=<mailbox>`
- `GET /api/email/:id?to=<mailbox>`
- `GET /api/stream?to=<mailbox>`

## Notes

- Input UI accepts local-part only (without `@domain`)
- Domain suffix is fixed and resolved from `MAIL_DOMAIN`
- Incoming emails are filtered and stored only for that configured domain
