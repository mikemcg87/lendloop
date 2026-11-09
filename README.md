# LendLoop

A neighbourhood tool-lending board. Neighbours list tools they are willing to lend, request each other's tools for a date range, and owners approve, decline and mark loans returned. n8n sends the notifications and chases overdue loans. Admins can see every loan, remove any listing and mark a lender as a "Trusted Lender".

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Lucide icons |
| Auth | Clerk; the role lives in `publicMetadata.role` and reaches Convex as a JWT claim |
| Data and backend logic | Convex (queries, mutations, HTTP actions, scheduler, file storage) |
| Automation | n8n, self-hosted with Docker ([`n8n/docker-compose.yml`](n8n/docker-compose.yml)) |
| Tests | Vitest + `convex-test`: 99 tests on permissions, loan states, idempotency and signatures |

## Contents

- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Access control](#access-control)
- [n8n workflows](#n8n-workflows)
- [Security decisions](#security-decisions)
- [Data-minimisation decisions](#data-minimisation-decisions)
- [Tests and verification](#tests-and-verification)
- [Known limitations](#known-limitations)
- [Production note](PRODUCTION_NOTES.md)

## Architecture

```
Browser ── Clerk session ──▶ Next.js (UI only, no API routes)
   │
   └─ Clerk JWT ("convex" template, carries `role`) ──▶ Convex functions
                                                          every function starts with
                                                          requireUser / requireAdmin
                                                               │
                                                               ▼
                                                           Convex DB
                                                               │
 ① status change ─▶ scheduler ─▶ HMAC-signed POST ─────────────┼─▶ n8n workflow 1 ─▶ notify user
                                                               │        │
                    signed POST /n8n/activity ◀────────────────┼────────┘ "notification sent"
                                                               │
 ② n8n workflow 2 (daily) ─ signed GET  /n8n/overdue-loans ───▶│
                          ─ signed POST /n8n/claim-reminder ──▶│  (idempotent claim, marks overdue)
                          ─ remind borrower                    │
                          ─ signed POST /n8n/activity ────────▶│  "reminder sent"
```

The browser talks to Convex directly, so there is no server of mine in between to enforce rules. **All access control therefore lives in the Convex functions.** The UI hides what a user cannot do, but that is cosmetic.

```
convex/
  schema.ts            tables and indexes
  auth.config.ts       Clerk JWT verification
  lib/auth.ts          requireUser / requireAdmin / assertOwner
  lib/loans.ts         the one place loan status changes happen
  lib/hmac.ts          sign / verify (Web Crypto)
  lib/domain.ts        categories, conditions, statuses
  users.ts tools.ts requests.ts admin.ts
  notifications.ts     signed webhook to n8n, with retries
  http.ts              signed endpoints n8n calls
  overdue.ts automation.ts
  seed.ts              optional demo data (CLI only)
  *.test.ts            test suite
src/
  proxy.ts             Clerk middleware (Next 16 names it "proxy")
  app/page.tsx         public page
  app/(app)/           signed-in area: dashboard and admin
  components/          UI
n8n/
  docker-compose.yml   n8n + a mock notification sink
  workflows/           the three workflow JSON files
```

## Local setup

Prerequisites: Node 20+, Docker, and a free Clerk account.

### 1. Install

```bash
npm install
```

### 2. Convex

```bash
npx convex dev
```

This creates a dev deployment, writes `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` to `.env.local`, and keeps watching `convex/`. Leave it running. The first push fails until `CLERK_JWT_ISSUER_DOMAIN` is set in step 3.

To run entirely on your machine with no Convex account, use `CONVEX_AGENT_MODE=anonymous npx convex dev`. That is how this project was developed, and it lets the local n8n container and Convex reach each other without a tunnel.

### 3. Clerk

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. **Configure → API keys**: copy the publishable and secret keys into `.env.local` (see [`.env.example`](.env.example)).
3. **Configure → JWT templates → New template → Convex**. Keep the name `convex` and use these claims:

   ```json
   {
     "aud": "convex",
     "name": "{{user.full_name}}",
     "email": "{{user.primary_email_address}}",
     "picture": "{{user.image_url}}",
     "nickname": "{{user.username}}",
     "role": "{{user.public_metadata.role}}"
   }
   ```

4. Copy the template's **Issuer** URL and give it to Convex:

   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
   ```

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

### 5. Make yourself an admin

In Clerk: **Users → your user → Metadata → Public**, set

```json
{ "role": "admin" }
```

Within a minute (the token lifetime) an **Admin** link appears in the header.

### 6. n8n

Generate one shared secret and give it to both sides:

```bash
openssl rand -hex 32
```

```bash
cp n8n/.env.example n8n/.env
```

Put the secret in `n8n/.env` as `N8N_WEBHOOK_SECRET`, then:

```bash
npx convex env set N8N_WEBHOOK_SECRET <the-same-secret>
```

```bash
npx convex env set N8N_NOTIFY_WEBHOOK_URL http://localhost:5678/webhook/lendloop-request-status
```

Start n8n and the mock notification sink:

```bash
docker compose -f n8n/docker-compose.yml up -d
```

Import the three workflows (their ids are fixed, so the error-workflow link survives the import):

```bash
docker compose -f n8n/docker-compose.yml exec n8n n8n import:workflow --separate --input=/workflows
```

Publish (activate) them and restart so the webhook and schedule register:

```bash
docker compose -f n8n/docker-compose.yml exec n8n sh -c 'for id in lendloopErrors01 lendloopNotify01 lendloopOverdue1; do n8n publish:workflow --id=$id; done'
```

```bash
docker compose -f n8n/docker-compose.yml restart n8n
```

The n8n editor is at [http://localhost:5678](http://localhost:5678) (it asks you to create a local owner account the first time). Notifications land in the mock sink's log:

```bash
docker compose -f n8n/docker-compose.yml logs -f notification-sink
```

Two things to know:

- `n8n/.env` defaults `LENDLOOP_CONVEX_SITE_URL` to `http://host.docker.internal:3211`, the HTTP-actions port of a local Convex backend. For a cloud deployment set it to `https://<deployment>.convex.site`.
- A **cloud** Convex deployment cannot call `localhost:5678`. Either use the local Convex backend (step 2), expose n8n through a tunnel, or use n8n Cloud, and set `N8N_NOTIFY_WEBHOOK_URL` accordingly.

### 7. Optional: demo data

Creates a demo neighbour with four tools and, if you pass your sign-in email, a loan to you that was due back two days ago, so the overdue workflow has something to act on:

```bash
npx convex run seed:demo '{"borrowerEmail":"you@example.com"}'
```

To run the overdue workflow without waiting for 08:00, open "LendLoop 2" in the n8n editor and execute it from the **Run now (manual test)** trigger. The loan flips to Overdue and shows "Overdue reminder sent just now" in the app.

## Environment variables

### Next.js (`.env.local`)

| Name | Purpose |
| --- | --- |
| `CONVEX_DEPLOYMENT` | Written by `npx convex dev` |
| `NEXT_PUBLIC_CONVEX_URL` | Written by `npx convex dev` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_…`) |
| `CLERK_SECRET_KEY` | Clerk secret key (`sk_…`), server only |

### Convex deployment (`npx convex env set NAME value`)

| Name | Required | Purpose |
| --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Issuer of the Clerk `convex` JWT template |
| `N8N_WEBHOOK_SECRET` | For n8n | Shared HMAC secret |
| `N8N_NOTIFY_WEBHOOK_URL` | For n8n | Production URL of workflow 1's webhook |

Without the two n8n variables the app still works: notifications are skipped with a log line and the `/n8n/*` endpoints answer 503.

### n8n (`n8n/.env`, read by docker-compose)

| Name | Purpose |
| --- | --- |
| `N8N_WEBHOOK_SECRET` | Same value as Convex's. Passed to n8n as `LENDLOOP_WEBHOOK_SECRET` |
| `LENDLOOP_CONVEX_SITE_URL` | Convex HTTP-actions URL as seen from the n8n container |
| `LENDLOOP_NOTIFY_SINK_URL` | Optional. Where notifications are POSTed as `{ to, text, event }`. Defaults to the mock sink |
| `LENDLOOP_ALERT_URL` | Optional. Where the error workflow POSTs failures. Defaults to the mock sink |

## Access control

Implemented in [`convex/lib/auth.ts`](convex/lib/auth.ts):

- `requireUser(ctx)` rejects calls without a valid Clerk token.
- `requireAdmin(ctx)` additionally requires the token's `role` claim to be exactly `"admin"`.
- `assertOwner(session, ownerId)` restricts a mutation to the owner of the row being changed.

| Action | Function | Who |
| --- | --- | --- |
| See name and category of available tools | `tools.listPublic` | Anyone |
| Browse all tools with availability | `tools.browse` | Signed in |
| List / edit / delete a tool | `tools.create` / `update` / `remove` | Signed in; edit and delete owner only |
| Request a tool, cancel own request | `requests.create` / `cancel` | Signed in; cancel borrower only |
| Approve / decline / mark returned | `requests.respond` / `markReturned` | Tool owner only |
| View all loans and users | `admin.listLoans` / `listUsers` | Admin |
| Remove any listing | `admin.removeListing` | Admin |
| Mark / unmark Trusted Lender | `admin.setTrustedLender` | Admin |

Loan status changes all pass through one function, `setRequestStatus` in [`convex/lib/loans.ts`](convex/lib/loans.ts), which updates the request, keeps the tool's availability in step and queues the notification in a single transaction.

## n8n workflows

The files in [`n8n/workflows/`](n8n/workflows) import into n8n 2.x as-is.

| File | Trigger | What it does |
| --- | --- | --- |
| `01-request-status-notifications.json` | Webhook from Convex | Verifies the HMAC of the raw body and its freshness (401 otherwise), acknowledges with 202, drops repeated `eventId`s, validates the payload, notifies the recipient, then reports the delivery back to Convex |
| `02-overdue-loan-reminders.json` | Daily at 08:00 (plus a manual trigger for testing) | Fetches overdue loans, claims each reminder in Convex, reminds the borrower, reports the delivery back |
| `error-handler.json` | Error Trigger | POSTs the failing workflow, node, message and execution link to the alert URL |

"Notify" is an HTTP POST of `{ to, text, event }` to `LENDLOOP_NOTIFY_SINK_URL`. Out of the box that is a container which logs what it receives (the brief allows a logged mock); a Slack or Discord incoming-webhook URL works with no workflow change.

### Signing

All signatures are hex HMAC-SHA256 with the shared secret, in the `X-LendLoop-Signature` header.

| Direction | Signed bytes | Replay protection |
| --- | --- | --- |
| Convex → n8n | The exact raw request body | `sentAt` inside the signed body; rejected if over 5 minutes old |
| n8n → Convex | `` `${timestamp}.${METHOD}.${path}.${body}` `` | `X-LendLoop-Timestamp`; rejected if over 5 minutes old. Method and path are signed, so a signature for one endpoint cannot be replayed on another |

n8n verifies against the raw bytes it received (the Webhook node's raw-body option feeding the Crypto node), not a re-serialised copy of the parsed JSON.

### Convex HTTP endpoints

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /n8n/overdue-loans` | none | `{ loans: [{ requestId, runDate, endDate, toolName, ownerName, borrower: { name, email } }] }` |
| `POST /n8n/claim-reminder` | `{ requestId, runDate }` | `{ claimed, result }` where `result` is `marked_overdue`, `still_overdue`, `already_claimed`, `not_overdue` or `not_found` |
| `POST /n8n/activity` | `{ requestId, kind, key, status? }` | `{ result }`: `recorded`, `already_recorded` or `not_found` |

### Idempotency and failure handling

- **No duplicate reminders.** Workflow 2 claims a reminder *before* sending it. Convex returns `claimed: true` only for the first call for a given loan and day, so node retries, a re-run, or two overlapping runs cannot send a second reminder. A loan returned between the fetch and the claim comes back `not_overdue` and is skipped.
- **No duplicate records.** `/n8n/activity` is keyed: a repeated write returns `already_recorded` and inserts nothing.
- **No duplicate notifications.** Each status change carries a stable `eventId` (`<requestId>:<status>`); workflow 1 drops ids it has already processed.
- **Convex → n8n retries.** The webhook is sent by a scheduled action after the mutation commits, so n8n being down never fails a user's action. It retries up to 5 times with exponential backoff.
- **n8n retries.** Every outbound HTTP node retries 3 times.
- **Failures are visible.** Both workflows name `LendLoop: Error handler` as their error workflow, which posts the failure and a link to the execution. A signed but malformed event stops with an explicit error and no empty message is sent.
- **Trade-off.** Claim-before-send makes reminders at-most-once per day: if the send still fails after its retries, that day's reminder is not re-sent, the error workflow reports it, and the next day's run reminds again. I chose that over the alternative, where a crash after sending could remind the same borrower twice.

### Automation activity (bonus)

Each delivery n8n reports is stored in `automationEvents` and shown on the loan in My Requests, Incoming Requests and the admin table, for example "Overdue reminder sent 2 days ago" or "New request notification sent just now". It records what n8n confirmed delivering, not what Convex merely attempted.

## Security decisions

- **Authorisation is enforced in Convex functions.** Every public function starts with `requireUser` or `requireAdmin`. Ownership is checked against the stored row, never against an id the client supplies.
- **The role is not stored in the database.** It is read from the verified Clerk JWT on every call. `publicMetadata` can only be written with the Clerk secret key, so users cannot promote themselves, and only the exact string `"admin"` counts.
- **Identity comes from the token only.** `users.store` takes no arguments, so a caller can only upsert their own profile and cannot set `trustedLender`.
- **Machine endpoints are signed and replay-resistant** in both directions, with constant-time verification (`crypto.subtle.verify`). The signature is checked over the raw bytes before any parsing.
- **No secrets in code or exports.** The workflow JSON reads configuration with `$env`; `.env.local` and `n8n/.env` are git-ignored; only `.env.example` files are committed. n8n is bound to `127.0.0.1` in docker-compose.
- **Internal functions stay internal.** Webhook dispatch, the overdue job's functions and the demo seed are `internal*` functions that no client can call.
- **Admin actions are audited.** Removing a listing and granting or revoking Trusted Lender each write an `adminAuditLog` row with the acting admin.
- **Input is validated at the boundary.** Convex validators type every argument; names, descriptions, dates and enum values are checked server-side; endpoint bodies are shape-checked after signature verification.
- **Concurrency is handled by the database.** Convex mutations are serialisable transactions, so two approvals of the same request, or two claims of the same reminder, cannot both succeed.

## Data-minimisation decisions

- **The public page gets three fields.** `tools.listPublic` returns `_id`, `name` and `category` for available tools only. Owner, description, condition and photo are never sent to anonymous visitors, rather than being fetched and hidden.
- **Users see display names, not contact details.** Signed-in queries return a counterpart's name and Trusted Lender flag. Email addresses are returned only to admins in the user list.
- **The notification webhook carries one recipient.** The payload is the recipient's name and email, the other party's display name, the tool name and the dates. Convex decides who the recipient is, so n8n never receives both parties' contact details.
- **The overdue endpoint returns only what a reminder needs:** the borrower's name and email, the tool and owner names, and the due date.
- **The notification sink gets `{ to, text, event }`** and nothing else.
- **Only the profile fields in use are stored** from Clerk: name, email (for notifications) and avatar URL. No phone number, address or location is collected; a "neighbourhood" is implied rather than modelled.
- **Listings are soft-deleted** so loan history stays readable, which means removed listings are retained. The production note covers a retention policy.

## Tests and verification

```bash
npm test
```

99 tests in four files, run against an in-memory Convex backend:

| File | What it proves |
| --- | --- |
| `convex/permissions.test.ts` | Every signed-in function rejects anonymous callers; the public feed exposes exactly three fields; users cannot touch others' tools or requests; non-admins and near-miss role claims (`"Admin"`, `"superuser"`, …) are rejected; admin actions write audit rows |
| `convex/requests.test.ts` | The loan state machine, date validation, duplicate and own-tool rules, and deletion behaviour |
| `convex/overdue.test.ts` | Overdue selection, claim idempotency and activity idempotency |
| `convex/http.test.ts` | Missing, wrong, stale, tampered and cross-endpoint-replayed signatures are rejected |

Also checked by hand during development, against n8n 2.46.7 in Docker and a local Convex backend:

- Signing in with Clerk, listing and editing a tool, the admin gate, and awarding Trusted Lender.
- Requesting a tool in the app produced a signed webhook, a notification in the sink, and "New request notification sent" on the loan.
- Running workflow 2 marked a seeded loan overdue, sent one reminder and showed "Overdue reminder sent" in the app. Running it again the same day sent nothing.
- n8n answered 401 to unsigned and wrongly signed webhooks.
- A signed but malformed event triggered the error workflow, which posted an alert with the execution link.

Not covered: there are no browser (end-to-end) tests, and the approve / decline / return buttons were exercised through the backend tests rather than by clicking through with two real accounts.

## Known limitations

- **One active loan per tool.** Approving a request marks the tool on loan until it is returned. Date ranges are stored and shown, but there is no calendar for overlapping future bookings.
- **Dates are UTC calendar dates,** so "overdue" flips at midnight UTC.
- **List views load up to 200 rows;** only the admin tables paginate.
- **Photos are optional** and not validated beyond the browser's file filter.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run dev:convex` | `convex dev` (push and watch backend functions) |
| `npm test` | Backend test suite |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
