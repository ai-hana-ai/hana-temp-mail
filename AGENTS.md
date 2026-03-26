# AGENTS.md

Guidance for coding agents working on this repository.

## Project Summary

- App type: temporary inbox service with optional passkey authentication and multi-domain support
- Runtime: Cloudflare Workers
- HTTP framework: Hono
- Frontend: server-rendered HTML from `src/ui.tsx` with Arrow-JS (`@arrow-js/core`) state/templates inlined in the page
- Auth: optional WebAuthn/passkey via SimpleWebAuthn (controlled by `ENABLE_PASSKEY` env var)
- Storage: Cloudflare D1 (`emails` table + `passkey_*` tables defined in `schema.sql`)
- Email ingestion: Cloudflare Email Routing -> Worker `email()` handler
- Realtime transport: Server-Sent Events (SSE) via `/api/stream`
- Main entry: `src/index.ts`
- Validation helpers: `src/validation.ts`
- Config: `wrangler.toml`

## Architecture

The app is intentionally compact and mostly single-worker:

1. `fetch()` serves the homepage and JSON API routes through Hono.
2. `email()` receives inbound mail from Cloudflare Email Routing, parses it with `postal-mime`, derives preview text, and stores the message in D1.
3. `scheduled()` runs periodic retention cleanup using the cron trigger in `wrangler.toml`.
4. `src/ui.tsx` renders the full UI and contains the Arrow-JS client logic for inbox activation, polling-by-SSE, and email detail display.

Treat `MAIL_DOMAINS` (comma-separated) as the source of truth for what mailbox domains the app accepts and displays. The first domain in the list is the primary/default domain. The app supports multiple domains via a dropdown selector in the UI.

When `ENABLE_PASSKEY` is `"true"`, the app requires WebAuthn authentication before granting access to the inbox workspace. The first visitor registers as the owner; subsequent visitors must authenticate. Passkey state is stored in D1.

## Data Model

Primary table: `emails`

- `id`: message UUID
- `id_to`: normalized recipient mailbox
- `id_from`: sender address
- `subject`: stored subject with `(No Subject)` fallback
- `body_text`: parsed plain-text body
- `body_html`: parsed HTML body
- `preview`: short preview used by inbox list responses
- `expires_at`: retention timestamp
- `timestamp`: insert timestamp used for ordering and SSE change detection

Important indexes:

- `idx_emails_to` for inbox lookups
- `idx_emails_expires_at` for cleanup

## Core Behavior (must preserve)

1. Mailbox input is local-part first; users should not need to type `@domain`.
2. Mail domains are configured via `MAIL_DOMAINS` (comma-separated). The first is the primary default.
3. Users can select which domain to use via a dropdown in the UI.
4. Mailbox normalization is shared between frontend and backend and must stay consistent.
5. UI includes the random mailbox generator button (`🎲`).
6. Inbox list stays hidden until the user explicitly opens an inbox.
7. Inbox updates happen in real time through `/api/stream`.
8. Email details support sanitized HTML rendering in an iframe, with plain-text fallback.
9. Inbox list responses return metadata and preview text, not full message bodies.
10. When `ENABLE_PASSKEY` is enabled, authentication is required before accessing the inbox workspace.
11. Retention remains best-effort and controlled by `RETENTION_DAYS`.

## API Endpoints

Keep these routes backward compatible unless the user explicitly requests otherwise.

- `GET /`
  - Returns the HTML UI.
- `GET /api/mailbox/random`
  - Returns a random mailbox for the configured domain.
  - Response shape: `{ mailbox, domains }`
- `GET /api/emails?to=<mailbox>`
  - Returns up to 50 inbox items for the normalized mailbox.
  - Requires mailbox validation against `MAIL_DOMAINS`.
  - Response is metadata only: `id`, `id_from`, `subject`, `timestamp`, `preview`
- `GET /api/email/:id?to=<mailbox>`
  - Returns the stored message only when both `id` and mailbox match.
- `GET /api/stream?to=<mailbox>`
  - Opens an SSE stream for the selected mailbox.
  - Emits `ready`, `update`, and `ping` events.

Error responses use JSON and currently include `error` plus `code`. Preserve that contract.

## Frontend Components

The UI is rendered from `src/ui.tsx` and is intentionally single-file.

- Hero/header: top-level branding and explanation
- Mailbox selector: local-part input, domain dropdown selector, random generator, open inbox action
- Status area: shows generation/loading/error state
- Inbox list: hidden until activation; shows sender, subject, timestamp, preview
- Email detail modal: opens selected message and chooses HTML iframe or plain-text `<pre>`

Arrow-JS state currently owns:

- `localPart`, `selectedDomain`, `availableDomains`, `activeMailbox`, `showInbox`
- `emails`, `selected`, `modalOpen`
- `auth` (passkey authentication state)
- SSE connection lifecycle
- basic HTML sanitization and iframe `srcdoc` rendering

Keep the UX simple. A single-page flow is acceptable for this project.

## SSE Implementation Details

- Endpoint: `/api/stream?to=<mailbox>`
- Transport: `text/event-stream`
- Headers include `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`
- Stream starts with a `ready` event containing the mailbox
- Worker checks the latest inbox timestamp roughly every 3 seconds
- When the latest timestamp changes, the server emits `update`
- When nothing changes, the server emits `ping`
- The frontend uses the stream as a notification channel, then refreshes inbox data via `/api/emails`

Do not replace SSE with WebSockets or polling unless explicitly requested.

## Validation and Security Constraints

- Local-part validation is defined in `src/validation.ts`
- Allowed local-part characters: lowercase letters, digits, `.`, `_`, `-`
- Local-part max length is 64
- Backend still tolerates full mailbox input only when the domain exactly matches one of `MAIL_DOMAINS`
- Normalize mailbox values to lowercase before persistence or lookup
- HTML email rendering must remain sanitized before inserting into iframe `srcdoc`
- Keep the iframe sandboxed; do not allow scripts
- Do not weaken recipient validation in the `email()` handler

## Rate Limiting and Retention

- API rate limiting is in-memory and keyed by client IP plus endpoint bucket
- Current buckets cover random mailbox generation, inbox listing, email detail, and stream creation
- This limiter is best-effort only; it is not durable across isolates
- `RETENTION_DAYS` defaults to 7 and is clamped in code
- Scheduled cleanup deletes rows whose `expires_at` has passed

Preserve these semantics unless a change is explicitly requested.

## Commands

```bash
pnpm install
pnpm wrangler dev
pnpm wrangler deploy --dry-run
pnpm wrangler deploy
```

Useful extra commands when touching storage:

```bash
pnpm wrangler d1 execute <db-name> --file=schema.sql
pnpm wrangler d1 execute <db-name> --file=./migrations/0001_preview_retention.sql --remote
```

## Editing Rules

- Keep API endpoints and response shapes backward compatible unless explicitly requested.
- Keep `MAIL_DOMAINS` as the source of truth for accepted mailbox domains.
- Mirror mailbox validation rules across frontend and backend; do not let them drift.
- Preserve the hidden-until-open inbox behavior.
- Preserve passkey authentication flow when `ENABLE_PASSKEY` is enabled.
- Preserve SSE-based realtime updates and event names unless explicitly requested.
- Do not remove HTML sanitization, iframe rendering, or plain-text fallback.
- Keep retention cleanup functional when changing schema or email ingestion logic.
- Prefer small, local changes; this app is intentionally compact.
- Keep styles simple and avoid introducing heavy frontend tooling without a clear reason.

## Deployment Notes

Cloudflare setup is required for the Worker to receive inbound mail.

- `MAIL_DOMAINS` must be configured with the domain(s) you actually control (comma-separated).
- `ENABLE_PASSKEY` set to `"true"` enables WebAuthn authentication (optional).
- D1 binding `DB` must exist and point to the correct database.
- Email Routing must be enabled for each domain in `MAIL_DOMAINS`.
- Add a catch-all Email Routing rule:
  - Matcher: `all`
  - Action: `Send to Worker`
  - Worker: deployed Worker for this project
- MX records for the configured domain must point to Cloudflare Email Routing targets.
- The cron trigger in `wrangler.toml` should stay enabled so expired emails are cleaned up.

Without Email Routing and valid DNS, the Worker can serve the UI but will not receive inbound email.
