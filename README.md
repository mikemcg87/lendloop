# LendLoop

A neighbourhood tool-lending library. Neighbours list the tools they own, request each other's tools for specific dates, and owners accept, decline and mark loans returned. Admins oversee every loan, can remove any listing, and can award a "Trusted Lender" badge.

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Lucide icons |
| Auth | Clerk, with the role held in `publicMetadata.role` |
| Backend and database | Convex (queries, mutations, HTTP actions, file storage, scheduler) |
| Automation | n8n (two workflows plus an error handler, exported in [`n8n/`](n8n)) |

## How it fits together

```
Browser ──Clerk session──▶ Next.js (UI only)
   │
   └─ Clerk JWT ("convex" template, carries `role`) ─▶ Convex functions
                                                        │  every function calls
                                                        │  requireUser / requireAdmin
                                                        ▼
                                                     Convex DB
                                                        │
        status change ─ scheduler ─▶ signed POST ───────┼──▶ n8n workflow 1 ─▶ notification
        n8n workflow 2 (daily) ── signed GET/POST ──────┘      (overdue reminders + write-back)
```

There is no Next.js API layer. The browser talks to Convex directly, so **all access control lives in the Convex functions**. The UI hides things a user cannot do, but that is cosmetic.

## Access control

Implemented in [`convex/lib/auth.ts`](convex/lib/auth.ts):

- `requireUser(ctx)` rejects calls without a valid Clerk token.
- `requireAdmin(ctx)` additionally requires the token's `role` claim to be exactly `"admin"`.
- `assertOwner(session, ownerId)` restricts a mutation to the row's owner.

The role is read from the verified JWT on every call and is never stored in Convex. It comes from Clerk `publicMetadata`, which can only be written with the Clerk secret key, so a user cannot promote themselves.

| Action | Function | Who |
| --- | --- | --- |
| See name, category, availability of tools | `tools.listPublic` | Anyone (returns only those three fields) |
| Browse tools with details | `tools.browse` | Signed in |
| Add / edit / delete a listing | `tools.create` / `update` / `remove` | Signed in; edit and delete owner only |
| Request a tool, cancel own request | `requests.create` / `cancel` | Signed in; cancel borrower only |
| Accept / decline / mark returned | `requests.respond` / `markReturned` | Tool owner only |
| View all loans and users | `admin.listLoans` / `listUsers` | Admin |
| Remove any listing | `admin.removeListing` | Admin |
| Award / revoke Trusted Lender | `admin.setTrustedLender` | Admin |

Admin mutations are recorded in the `adminAuditLog` table.

## Local setup

Prerequisites: Node 20+, a Clerk account (free), and optionally an n8n instance.

### 1. Install

```bash
npm install
```

### 2. Convex

```bash
npx convex dev
```

This logs you in, creates a dev deployment, writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to `.env.local`, and keeps watching `convex/`. Leave it running. (To run without a Convex account, prefix with `CONVEX_AGENT_MODE=anonymous` for a purely local backend.)

The first push fails until `CLERK_JWT_ISSUER_DOMAIN` is set; step 3 covers it.

### 3. Clerk

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com) (the consumer/B2C option; Organizations are not used).
2. **Configure → API keys**: copy the publishable and secret keys into `.env.local`.
3. **Configure → JWT templates → New template → Convex**. Keep the name `convex` and add the role claim:

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

Open [http://localhost:3000](http://localhost:3000).

### 5. Make yourself an admin

Sign up in the app, then in Clerk: **Users → your user → Metadata → Public** and set

```json
{ "role": "admin" }
```

Sign out and back in so a fresh token carries the role. An **Admin** link appears in the header.

## Environment variables

### Next.js (`.env.local`, see [`.env.example`](.env.example))

| Name | Purpose |
| --- | --- |
| `CONVEX_DEPLOYMENT` | Written by `npx convex dev` |
| `NEXT_PUBLIC_CONVEX_URL` | Written by `npx convex dev` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_…`) |
| `CLERK_SECRET_KEY` | Clerk secret key (`sk_…`) |

### Convex deployment (`npx convex env set NAME value`)

| Name | Required | Purpose |
| --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Issuer of the Clerk `convex` JWT template |
| `N8N_WEBHOOK_SECRET` | For n8n | Shared HMAC secret. Generate with `openssl rand -hex 32` |
| `N8N_NOTIFY_WEBHOOK_URL` | For n8n | Production URL of workflow 1's webhook |

Without the two n8n variables the app works normally; notifications are skipped with a log line, and the `/n8n/*` endpoints answer 503.

### n8n instance environment

| Name | Purpose |
| --- | --- |
| `LENDLOOP_WEBHOOK_SECRET` | Same value as Convex's `N8N_WEBHOOK_SECRET` |
| `LENDLOOP_CONVEX_SITE_URL` | The deployment's HTTP actions URL (`https://<name>.convex.site`, no trailing slash) |
| `LENDLOOP_NOTIFY_SINK_URL` | Where notifications are POSTed as `{ text, event, eventId, to }` (for example a Slack or Discord incoming webhook) |
| `LENDLOOP_ALERT_URL` | Where the error handler POSTs failures |

The workflows read these with `$env`, so the exported JSON contains no secrets. `$env` access must be allowed on the instance (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, the self-hosted default).

## n8n workflows

Import each file from [`n8n/`](n8n) (**Workflows → Import from file**), then open workflows 1 and 2 and set **Settings → Error workflow** to "LendLoop: Error handler".

| File | Trigger | What it does |
| --- | --- | --- |
| `01-request-status-notifications.json` | Webhook from Convex | Verifies the HMAC signature and timestamp, acknowledges with 202, drops events it has already seen, builds a message for the right recipient, POSTs it to the sink with 3 tries |
| `02-overdue-loan-reminders.json` | Daily at 08:00 | Signed GET for loans due a reminder, POSTs a reminder per loan, then a signed POST writes the overdue status back to Convex |
| `error-handler.json` | Error Trigger | POSTs the failing workflow, node and message to the alert URL |

After activating workflow 1, copy its production webhook URL into Convex:

```bash
npx convex env set N8N_NOTIFY_WEBHOOK_URL https://your-n8n.example/webhook/lendloop-request-status
```

### Signing scheme

All signatures are hex HMAC-SHA256 with the shared secret, sent as `X-LendLoop-Signature` alongside `X-LendLoop-Timestamp` (Unix milliseconds). Requests more than 5 minutes old are rejected.

| Direction | Signed string |
| --- | --- |
| Convex → n8n (workflow 1) | `` `${timestamp}.${body}` `` |
| n8n → Convex (workflow 2) | `` `${timestamp}.${METHOD}.${path}.${body}` `` (body is empty for GET) |

### Convex HTTP endpoints

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /n8n/overdue-loans` | none | `{ loans: [{ requestId, runDate, endDate, toolName, owner, borrower }] }` |
| `POST /n8n/mark-overdue` | `{ requestId, runDate }` | `{ requestId, runDate, result }` |

`result` is one of `marked_overdue`, `reminder_recorded`, `already_processed`, `not_overdue`, `not_found`. The pair `(requestId, runDate)` is the idempotency key: sending the same write-back twice returns `already_processed` and changes nothing. Loans reminded today are also left out of the GET, so re-running the workflow the same day sends nothing.

### Reliability

- **Convex → n8n**: the POST is scheduled after the mutation commits, so a failed webhook never rolls back a user action. Failures retry up to 5 times with exponential backoff (2s to 16s). The stable `eventId` (`<requestId>:<status>`) lets n8n discard repeats.
- **n8n nodes**: every outbound HTTP node retries 3 times. A run that still fails triggers the error handler.
- **Overdue reminders are at-least-once**: the reminder is sent before the write-back, so a crash between the two can repeat one reminder on the next run. That is preferred to silently skipping one.

## Project structure

```
convex/
  schema.ts            tables and indexes
  auth.config.ts       Clerk JWT verification
  lib/auth.ts          requireUser / requireAdmin / assertOwner
  lib/loans.ts         status transitions, soft delete, shared joins
  lib/hmac.ts          sign / verify
  lib/domain.ts        categories and request statuses
  users.ts tools.ts requests.ts admin.ts
  notifications.ts     signed webhook to n8n, with retries
  overdue.ts http.ts   signed endpoints for the daily job
src/
  proxy.ts             Clerk middleware (Next 16 calls it "proxy")
  app/page.tsx         public landing page
  app/(app)/           signed-in area: dashboard and admin
  components/          UI
n8n/                   exported workflows
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run dev:convex` | `convex dev` (push and watch backend functions) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## Deploying

1. `npx convex deploy` for a production Convex deployment, then set its three environment variables.
2. Create a Clerk production instance, repeat the JWT template, and use its keys and issuer.
3. Deploy the Next.js app (for example on Vercel) with the four `.env.local` variables set for production.

## Verification status

Checked during development:

- TypeScript and ESLint pass for the app and the Convex functions.
- Unauthenticated calls to user and admin functions are rejected ("Sign in required").
- `/dashboard` and `/admin` redirect signed-out visitors to Clerk.
- The `/n8n/*` endpoints: unsigned, stale, tampered and cross-endpoint-replayed requests get 401; correctly signed requests succeed.

Not yet checked:

- The signed-in and admin screens end to end with real accounts.
- The n8n workflows imported into a live n8n instance. The JSON is structurally valid, but node parameters were written by hand against n8n 1.x node versions and have not been run.
- There is no automated test suite.

## Known limitations

- One active loan per tool. Accepting a request marks the tool "on loan" until it is returned; date ranges are recorded but there is no booking calendar for overlapping future loans.
- Dates are calendar dates compared in UTC, so "overdue" flips at midnight UTC.
- List views load up to 200 rows; only the admin tables paginate.

See [PRODUCTION_NOTES.md](PRODUCTION_NOTES.md) for design decisions and what would change at scale.
