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

## API Endpoints

- `GET /api/mailbox/random`
- `GET /api/emails?to=<mailbox>`
- `GET /api/email/:id?to=<mailbox>`
- `GET /api/stream?to=<mailbox>`

## Notes

- Input UI accepts local-part only (without `@domain`)
- Domain suffix is fixed and resolved from `MAIL_DOMAIN`
- Incoming emails are filtered and stored only for that configured domain
