# AGENTS.md

Guidance for coding agents (Codex/ACP/etc.) working on this repository.

## Project Overview

- Stack: Cloudflare Workers + Hono + Alpine.js + D1
- Main entry: `src/index.ts`
- Config: `wrangler.toml`
- Schema: `schema.sql`

## Core Behavior (must preserve)

1. Input accepts **local-part only** (no `@domain` typed by user).
2. Mail domain is fixed from env var: `MAIL_DOMAIN`.
3. UI has random generator (🎲) for local-part.
4. Inbox list appears only after user submits inbox.
5. Real-time updates use SSE endpoint (`/api/stream`).
6. Email details support HTML body rendering in iframe, with plain-text fallback.

## Commands

```bash
pnpm install
pnpm wrangler dev
pnpm wrangler deploy --dry-run
pnpm wrangler deploy
```

## Editing Rules

- Keep API endpoints backward compatible unless explicitly requested.
- Keep `MAIL_DOMAIN` as single source of truth for domain restrictions.
- Validate mailbox input consistently between frontend and backend.
- Do not remove SSE unless explicitly requested.
- Keep styles simple (single-file UI is acceptable for now).

## Deployment Notes

Cloudflare Email Routing must be configured in dashboard:
- Route matcher: `all`
- Action: `Send to Worker`
- Worker: `hana-temp-mail`

Without this route, inbound mail to `@adopsee.com` will fail even if Worker is deployed.
