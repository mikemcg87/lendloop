# LendLoop

[![CI](https://github.com/mikemcg87/lendloop/actions/workflows/ci.yml/badge.svg)](https://github.com/mikemcg87/lendloop/actions/workflows/ci.yml)

A neighbourhood tool-lending board. Neighbours list tools, ask to borrow each other's for a date range, and owners approve, decline and mark loans returned, noting any damage. n8n sends the notifications and chases overdue loans. Admins can see every loan, remove any listing and mark a lender as a Trusted Lender.

Built with Next.js 16 (App Router), Clerk, Convex, n8n and TypeScript.

- [Live demo](#live-demo)
- [How it fits together](#how-it-fits-together)
- [Local setup](#local-setup)
- [Security decisions](#security-decisions)
- [Data-minimisation decisions](#data-minimisation-decisions)
- [The n8n integration](#the-n8n-integration)
- [What is tested](#what-is-tested)
- [Known limitations](#known-limitations)
- [Reference: env vars, endpoints, permissions](docs/REFERENCE.md)
- [What I would change for production](PRODUCTION_NOTES.md)

## Live demo

**[lendloop.michaeljmcglade.com](https://lendloop.michaeljmcglade.com)**: the app on Vercel, a Convex cloud deployment and the three workflows on a self-hosted n8n.

- **Sign up with any email.** A new account is given an overdue loan (a sander from a demo neighbour) and an incoming request for a ladder listed in its name, so one account can approve or decline, mark a loan returned, note damage and see the overdue stamp. To sign up without a real inbox, use an address containing `+clerk_test`, such as `you+clerk_test@example.com`, and enter `424242` as the code.
- **Admin login:** `demo-admin+clerk_test@example.com` / `lendlooptakehome123`. If Clerk asks for an emailed code, enter `424242` (it is a Clerk test address). The admin role is granted in Clerk metadata, which only the secret key can write, so an account you create yourself is always an ordinary user. On this demo the admin's member list shows names without emails.
- **The demo resets every day at 04:00 UTC.** The app's own data (profiles, listings, loans, uploads) is wiped and the neighbours' board is restored. Sign in again for a fresh start. The reset does not delete the Clerk account or n8n's execution history.
- **Notifications go to a mock sink, not to your inbox.** Each loan shows what n8n reported back ("notification sent", "reminder sent"). The sink's log on the n8n host does contain the recipient's address, which is one more reason to sign up with a test address. The overdue job runs daily at 08:00 UK time.
- **Listing photos are AI-generated stand-ins.**

All of this is switched on by setting `DEMO_MODE` to `true` on that deployment ([reference](docs/REFERENCE.md#convex-deployment-npx-convex-env-set-name-value)); a normal install has none of it.

## How it fits together

```
Browser ── Clerk session ──▶ Next.js (UI only, no API routes)
   │
   └─ Clerk JWT (carries `role`) ──▶ Convex functions ──▶ Convex DB
                                     signed-in ones start with │
                                     requireUser/requireAdmin  │
                                                               │
 ① status change ─▶ scheduler ─▶ signed POST ──────────────────┼─▶ n8n workflow 1 ─▶ notify
                    signed POST /n8n/activity ◀────────────────┼────────┘
                                                               │
 ② n8n workflow 2 (daily) ─ signed GET  /n8n/overdue-loans ───▶│
                          ─ signed POST /n8n/claim-reminder ──▶│  one loan at a time
                          ─ remind borrower                    │
                          ─ signed POST /n8n/activity ────────▶│
```

The browser talks to Convex directly, so there is no server of mine in between to enforce rules. All access control therefore lives in the Convex functions. The UI hides what you cannot do, but that is cosmetic.

Where things are:

| Path | What |
| --- | --- |
| `convex/lib/auth.ts` | `requireUser`, `requireAdmin`, `assertOwner` |
| `convex/lib/loans.ts` | Where a person's action changes a loan's status (the overdue job's change is in `convex/overdue.ts`) |
| `convex/http.ts`, `convex/lib/hmac.ts` | The signed endpoints n8n calls |
| `convex/notifications.ts` | The signed webhook to n8n, with retries |
| `convex/*.test.ts` | 141 backend tests |
| `src/app`, `src/components` | Public page, dashboard, admin |
| `n8n/` | docker-compose and the three exported workflows |

## Local setup

You need Node 22+, Docker and a free Clerk account. About ten minutes.

### 1. Install

```bash
npm install
```

### 2. Convex

```bash
CONVEX_AGENT_MODE=anonymous npx convex dev
```

This runs a Convex backend on your machine with no Convex account, writes its URL to `.env.local`, and keeps watching `convex/`. Leave it running. The first push fails until step 3 sets `CLERK_JWT_ISSUER_DOMAIN`; after that, wait for it to report that the functions are ready before going on. It needs ports 3210 and 3211 free: n8n is configured to find Convex on 3211, so if Convex picked another port, set `LENDLOOP_CONVEX_SITE_URL` in `n8n/.env` to match.

Running Convex locally also lets the n8n container and Convex reach each other without a tunnel. A cloud deployment (`npx convex dev`) works too, but it cannot call an n8n on `localhost`; see the [reference](docs/REFERENCE.md#using-a-cloud-convex-deployment).

### 3. Clerk

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. **Configure → API keys**: copy both keys into `.env.local` (names are in [`.env.example`](.env.example)).
3. **Configure → JWT templates → New template → Convex**. Keep the name `convex` and add one claim to the defaults:

   ```json
   {
     "aud": "convex",
     "name": "{{user.full_name}}",
     "email": "{{user.primary_email_address}}",
     "picture": "{{user.image_url}}",
     "role": "{{user.public_metadata.role}}"
   }
   ```

4. Give Convex the template's **Issuer** URL:

   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
   ```

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

### 5. Demo data, so one account is enough

```bash
npx convex run seed:demo '{"borrowerEmail":"the-email-you-signed-in-with","photosFrom":"http://localhost:3000"}'
```

This adds two demo neighbours with sixteen listings between them (one of them a pineapple), a loan to you that is already overdue (for the reminder workflow), and a request from a neighbour for a ladder of yours (so you can approve or decline it, then mark it returned and note any damage). Sign in first: the seed creates nothing until it finds your account.

`photosFrom` is where the app is running; the seed copies the photos in `public/demo` from there into Convex file storage. Those photos are AI-generated stand-ins, not real listings.

### 6. Make yourself an admin

In Clerk: **Users → your user → Metadata → Public**, set

```json
{ "role": "admin" }
```

Within a minute (the token lifetime) an **Admin** link appears in the header.

### 7. n8n

Generate one shared secret:

```bash
openssl rand -hex 32
```

```bash
cp n8n/.env.example n8n/.env
```

Put the secret in `n8n/.env` as `N8N_WEBHOOK_SECRET`, then give Convex the same secret and the webhook address:

```bash
npx convex env set N8N_WEBHOOK_SECRET <the-same-secret>
```

```bash
npx convex env set N8N_NOTIFY_WEBHOOK_URL http://localhost:5678/webhook/lendloop-request-status
```

Start n8n and the mock notification sink, import the workflows, activate them, and restart so the webhook and schedule register:

```bash
docker compose -f n8n/docker-compose.yml up -d
```

```bash
docker compose -f n8n/docker-compose.yml exec n8n n8n import:workflow --separate --input=/workflows
```

```bash
docker compose -f n8n/docker-compose.yml exec n8n sh -c 'for id in lendloopErrors01 lendloopNotify01 lendloopOverdue1; do n8n publish:workflow --id=$id; done'
```

```bash
docker compose -f n8n/docker-compose.yml restart n8n
```

Notifications land in the mock sink's log:

```bash
docker compose -f n8n/docker-compose.yml logs -f notification-sink
```

Now request a tool in the app and watch the log. To run the overdue job without waiting for 08:00, open the n8n editor at [http://localhost:5678](http://localhost:5678) (the first visit asks you to create a local owner account), open "LendLoop 2" and execute it from the **Run now (manual test)** trigger. The seeded loan gets its reminder and shows "Reminder sent" in the app. A run started by hand in the editor does not call the error workflow; n8n only does that for webhook and scheduled runs.

Real email through Amazon SES is optional and described in the [reference](docs/REFERENCE.md#email-through-amazon-ses).

## Security decisions

- **Authorisation is enforced in Convex functions.** Every function that needs a signed-in user starts with `requireUser` or `requireAdmin`. The exceptions are deliberate: the public tool list, the two profile functions that read the token directly, and the machine endpoints, which check a signature instead. Ownership is checked against the stored row, never against an id the client sends.
- **The role is not stored in my database.** It is read from the verified Clerk JWT on every call. `publicMetadata` can only be written with the Clerk secret key, so users cannot promote themselves, and only the exact string `"admin"` counts.
- **Identity comes from the token only.** `users.store` takes no arguments, so a caller can only upsert their own profile and cannot set `trustedLender`.
- **Machine endpoints are signed in both directions** with HMAC-SHA256 and a five-minute freshness window. Convex verifies over the raw bytes, before parsing, with a constant-time comparison (`crypto.subtle.verify`). The method and path are part of what n8n signs, so a signature for one endpoint cannot be replayed on another.
- **No secrets in code or exports.** Workflows read configuration from `$env`; the AWS key for SES lives in an n8n credential that the export only refers to by id and name. `.env.local`, `n8n/.env` and `n8n/credentials.json` are git-ignored. n8n is bound to `127.0.0.1`.
- **Internal functions stay internal.** Webhook dispatch, the overdue job's functions and the demo seed are `internal*` functions that no client can call.
- **Admin actions are audited.** Removing a listing and granting or revoking Trusted Lender each write an `adminAuditLog` row naming the admin.
- **Input is validated on the server.** Convex validators type every argument. Names, descriptions, dates (including impossible ones such as 31 February) and uploaded photos (type, size, and that the file is not already on someone else's listing) are checked in the function, not just the form.
- **Concurrency is the database's job.** Convex mutations are serialisable transactions, so two approvals of the same request cannot both succeed.
- **Baseline response headers** (`nosniff`, frame denial, referrer policy, HSTS) are set in `next.config.ts`. Dependencies pass `npm audit` with no advisories, and CI fails on any of moderate severity or above.

## Data-minimisation decisions

- **The public page gets three fields.** `tools.listPublic` returns `_id`, `name` and `category` for available tools only. Owner, description, condition and photo never leave the backend for anonymous visitors.
- **Users see display names, not contact details.** Email addresses are returned only to admins, in the member list.
- **The notification webhook carries one recipient.** Convex decides who should hear about an event and sends that person's name and email, the other party's display name, the tool name and the dates. n8n never receives both parties' contact details.
- **The overdue endpoint returns only what a reminder needs:** the borrower's name and email, the tool and owner names, and the due date.
- **Only the profile fields in use are stored** from Clerk: name, email and avatar URL. No phone number, address or location. The neighbourhood is implied, not modelled.
- **Listings are soft-deleted** so loan history stays readable, which means removed listings are kept. The production note covers retention.

## The n8n integration

The three files in [`n8n/workflows/`](n8n/workflows) import into n8n 2.x as they are.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| 1. Request status notifications | Webhook from Convex | Verifies the signature and freshness (401 if not), answers 202, drops events it has already seen, checks the payload, notifies the recipient, then tells Convex it was delivered |
| 2. Overdue loan reminders | Daily at 08:00, plus a manual trigger | Fetches overdue loans and, one loan at a time, claims the reminder in Convex, reminds the borrower and reports the delivery back |
| Error handler | Any failure in 1 or 2 | Posts the workflow, node, message and a link to the execution to the alert URL |

By default "notify" is an HTTP POST of `{ to, text, event }` to a container that logs it, which the brief allows. Point `LENDLOOP_NOTIFY_SINK_URL` at a Slack incoming webhook, or switch `LENDLOOP_NOTIFY_CHANNEL` to `ses` for real email, with no workflow change.

What is and is not guaranteed:

- **Activity records are exactly-once.** `/n8n/activity` is keyed; a repeated write changes nothing.
- **Notifications are deduplicated by event.** Each status change has a stable `eventId`, and workflow 1 drops ids it has seen. The send itself is retried up to three times, so a provider that accepted a message but timed out answering could receive it twice.
- **Reminders are at-least-once per day.** Workflow 2 claims a reminder in Convex before sending and reports the delivery afterwards. Once the delivery is recorded, further claims for that loan and day are refused, so a re-run sends nothing. Until then the claim can be taken again. That covers the awkward case where Convex stored the claim but n8n never saw the answer: the retry still sends. The cost is that a crash between sending and reporting can remind someone twice. I chose that over a reminder that is skipped with no trace. Loans go through one at a time, so a retry repeats only the loan that failed.
- **n8n being down does not fail a user's action.** The webhook is sent by a scheduled action after the mutation commits, with five attempts and exponential backoff. If every attempt fails, Convex records that on the loan, which then shows "notification could not be sent".
- **Failures inside n8n run the error workflow,** which posts the workflow, node and message to the alert URL.
- **The gap that remains.** Workflow 1 answers 202 as soon as the signature checks out, before it delivers. Convex treats that as done. If n8n then fails, the error workflow reports it, but the loan itself shows neither a delivery nor a failure; and if the n8n process dies outright at that moment, nothing reports it. Closing that needs a pending state on the Convex side with an alert on stale entries, which is in the production note.

Each delivery n8n confirms is shown on the loan itself ("Reminder sent 2 days ago"), for the borrower, the owner and admins. It records what n8n delivered, not what Convex attempted.

Signing formats, endpoint shapes and every environment variable are in the [reference](docs/REFERENCE.md).

## What is tested

```bash
npm test
```

141 tests in six files, run against an in-memory Convex backend. CI runs them with lint, a type check, a production build and `npm audit` on pushes to `main` and on pull requests.

| File | What it proves |
| --- | --- |
| `permissions.test.ts` | Signed-in functions reject anonymous callers; the public feed exposes exactly three fields; users cannot touch others' tools or requests; near-miss role claims (`"Admin"`, `"superuser"`) are rejected; no email reaches ordinary users; photo uploads are type-checked and cannot be taken from another listing; the availability filter; the admin listing and overdue filters |
| `requests.test.ts` | The loan state machine, date validation, duplicate and own-tool rules, the damage note on return, deletion |
| `overdue.test.ts` | Which loans are due, that a claim can be resumed until its delivery is recorded and not after, a late claim for an earlier day, activity idempotency |
| `http.test.ts` | Missing, wrong, stale, tampered and cross-endpoint-replayed signatures are rejected |
| `notifications.test.ts` | Who the recipient is for each event, the exact payload fields, the signature over the exact body, retries, and the recorded failure |
| `seed.test.ts` | The demo seed waits for the borrower and runs once; the public-demo behaviour (daily reset, starter loans private to each new account, hidden member emails) is off unless `DEMO_MODE` is exactly `true` |

Checked by hand against n8n 2.46.7 in Docker and a local Convex backend:

- Unsigned, wrongly signed, tampered and stale webhooks get 401; a valid one gets 202 and one notification; sending it again produces no second notification.
- A signed but malformed event sends nothing and raises an alert through the error workflow.
- With two overdue loans, the overdue job sent two correct reminders and marked both; running it again the same day sent none.
- The public page lists only available tools, and the signed-in area redirects to Clerk when signed out.
- Clicked through with the demo data: add, amend and remove a listing, including a photo upload; borrow and withdraw; approve and mark returned with a damage note; the overdue stamp and "Reminder sent" on the loan; the admin loan list, member list (grant and withdraw Trusted Lender) and listing removal; the layout at phone width.

Declining a request, and two real accounts acting on each other, were covered by the backend tests only. There are no automated browser tests; that is the first thing I would add, see the production note.

## Known limitations

- **One active loan per tool.** Approving a request marks the tool on loan until it is returned. Date ranges are stored and shown, but there is no calendar of future bookings.
- **Dates are UTC calendar dates,** so a loan becomes overdue at midnight UTC.
- **The board and "my" views load up to 200 rows;** the admin tables paginate.
- **No rate limiting** on mutations or uploads, and an upload is checked when it is attached to a listing, not when it is stored.
- **The overdue job reads at most 500 loans per status per run.**
- **n8n compares the webhook signature with ordinary string equality.** Convex's side is constant-time; n8n's built-in nodes do not offer that.
- **Amazon SES is in sandbox mode** on my account, so real email only reaches verified addresses.
