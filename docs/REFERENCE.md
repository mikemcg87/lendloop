# Reference

Lookup material for the [README](../README.md).

## Environment variables

### Next.js (`.env.local`)

| Name | Purpose |
| --- | --- |
| `CONVEX_DEPLOYMENT` | Written by `npx convex dev` |
| `NEXT_PUBLIC_CONVEX_URL` | Written by `npx convex dev` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_…`) |
| `CLERK_SECRET_KEY` | Clerk secret key (`sk_…`), server only |

### Convex deployment (`npx convex env set NAME value`)

These are not read from `.env.local`; they live on the Convex deployment.

| Name | Required | Purpose |
| --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Yes | Issuer of the Clerk `convex` JWT template |
| `N8N_WEBHOOK_SECRET` | For n8n | Shared HMAC secret |
| `N8N_NOTIFY_WEBHOOK_URL` | For n8n | Production URL of workflow 1's webhook |
| `DEMO_MODE` | Public demo only | Exactly `true` turns on three things (any other value is off): a daily reset that wipes every account, listing, loan and uploaded file and restores the demo board; a starter overdue loan and incoming request for each new account; and hiding member emails from admins. Never set it on a deployment with real data |
| `DEMO_PHOTOS_FROM` | Public demo only | The app's public URL, where the demo photos are fetched from |

Without the two n8n variables the app still works: notifications are skipped with a log line and the `/n8n/*` endpoints answer 503.

### n8n (`n8n/.env`, read by docker-compose)

| Name | Purpose |
| --- | --- |
| `N8N_WEBHOOK_SECRET` | Same value as Convex's. Reaches n8n as `LENDLOOP_WEBHOOK_SECRET` |
| `LENDLOOP_CONVEX_SITE_URL` | Convex HTTP-actions URL as seen from the n8n container. Defaults to `http://host.docker.internal:3211`, a local Convex backend |
| `LENDLOOP_NOTIFY_CHANNEL` | `mock` (default) or `ses` |
| `LENDLOOP_SES_FROM` | Verified SES sender address, for the `ses` channel |
| `LENDLOOP_NOTIFY_SINK_URL` | Optional. Where mock notifications are POSTed as `{ to, text, event }` |
| `LENDLOOP_ALERT_URL` | Optional. Where the error workflow POSTs failures |
| `GENERIC_TIMEZONE` | Optional. n8n's time zone, which decides when "08:00" is. Defaults to `Europe/London` |

## Who can do what

Implemented in [`convex/lib/auth.ts`](../convex/lib/auth.ts).

| Action | Function | Who |
| --- | --- | --- |
| See name and category of available tools | `tools.listPublic` | Anyone |
| Browse all tools with availability | `tools.browse` | Signed in |
| List / edit / delete a tool | `tools.create` / `update` / `remove` | Signed in; edit and delete owner only |
| Request a tool, withdraw own request | `requests.create` / `cancel` | Signed in; withdraw borrower only |
| Approve / decline / mark returned (with an optional damage note) | `requests.respond` / `markReturned` | Tool owner only |
| View all loans and members | `admin.listLoans` / `listUsers` | Admin |
| Remove any listing | `admin.removeListing` | Admin |
| Mark / unmark Trusted Lender | `admin.setTrustedLender` | Admin |

Every status change a person makes goes through `setRequestStatus` in [`convex/lib/loans.ts`](../convex/lib/loans.ts), which updates the request, keeps the tool's availability in step and queues the notification in one transaction. The one change no person makes, accepted to overdue, happens in `overdue.claimReminder` when the daily n8n job claims its first reminder; the reminder itself is the notification. Until that job runs, the app shows a loan past its due date as overdue anyway, and the admin filter treats it as such.

Loan states:

```
requested ─▶ accepted ─▶ returned
    │            └─▶ overdue ─▶ returned
    ├─▶ rejected
    └─▶ cancelled
```

## Signing

All signatures are hex HMAC-SHA256 with the shared secret, in the `X-LendLoop-Signature` header.

| Direction | Signed bytes | Replay protection |
| --- | --- | --- |
| Convex → n8n | The exact raw request body | `sentAt` inside the signed body; rejected if over 5 minutes old |
| n8n → Convex | `` `${timestamp}.${METHOD}.${path}.${body}` `` | `X-LendLoop-Timestamp`; rejected if over 5 minutes old |

n8n verifies against the raw bytes it received (the Webhook node's raw-body option feeding the Crypto node), not a re-serialised copy of the parsed JSON.

## Convex HTTP endpoints

All three require a valid signature and answer 401 without one.

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /n8n/overdue-loans` | none | `{ loans: [{ requestId, runDate, endDate, toolName, ownerName, borrower: { name, email } }] }` |
| `POST /n8n/claim-reminder` | `{ requestId, runDate }` | `{ claimed, result }` where `result` is `marked_overdue`, `still_overdue`, `resumed` (claimed earlier today, no delivery recorded yet), `already_claimed`, `not_overdue` or `not_found` |
| `POST /n8n/activity` | `{ requestId, kind, key, status? }` | `{ result }`: `recorded`, `already_recorded` or `not_found` |

## Webhook payload (Convex → n8n)

```json
{
  "eventId": "<requestId>:<status>",
  "event": "requested | accepted | rejected | cancelled | returned",
  "requestId": "…",
  "recipient": { "name": "…", "email": "…" },
  "counterpartName": "…",
  "toolName": "…",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "sentAt": 1794484401000
}
```

The owner is the recipient for `requested` and `cancelled`; the borrower for everything else.

## Email through Amazon SES

Optional. The default channel logs notifications to the mock sink.

1. In AWS, verify a sender identity in SES and create an IAM user allowed only `ses:SendEmail` and `ses:SendRawEmail` from that address.
2. Copy the credential template and fill in that user's access key:

   ```bash
   cp n8n/credentials.example.json n8n/credentials.json
   ```

3. Import it into n8n's encrypted credential store:

   ```bash
   docker compose -f n8n/docker-compose.yml cp n8n/credentials.json n8n:/tmp/credentials.json
   ```

   ```bash
   docker compose -f n8n/docker-compose.yml exec n8n n8n import:credentials --input=/tmp/credentials.json
   ```

4. In `n8n/.env` set `LENDLOOP_NOTIFY_CHANNEL=ses` and `LENDLOOP_SES_FROM` to the verified address, then recreate the container:

   ```bash
   docker compose -f n8n/docker-compose.yml up -d n8n
   ```

`n8n/credentials.json` is git-ignored. The workflow exports refer to the credential by id and name only. While an SES account is in sandbox mode it delivers only to verified addresses.

## Using a cloud Convex deployment

A cloud Convex deployment cannot call `localhost:5678`. Either expose n8n through a tunnel or use a hosted n8n, then:

- set `N8N_NOTIFY_WEBHOOK_URL` on Convex to the public webhook URL, and
- set `LENDLOOP_CONVEX_SITE_URL` in `n8n/.env` to `https://<deployment>.convex.site`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run dev:convex` | `convex dev` (push and watch backend functions) |
| `npm test` | Backend test suite |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` | Production build |
