# Production notes

Why LendLoop is built the way it is, and what would change on the way to 100k+ users.

## Architectural decisions

### 1. Authorisation lives in Convex, nowhere else

The browser calls Convex directly, so a Next.js middleware check or a hidden button protects nothing. Every public function begins with `requireUser` or `requireAdmin` (`convex/lib/auth.ts`), and ownership is checked against the row being changed, never against an id supplied by the client.

`users.store` takes no arguments: the profile is built from the verified token, so a caller can only ever upsert their own row and cannot set `trustedLender`.

### 2. The role comes from the JWT, not the database

The admin role is a claim on the Clerk token, sourced from `publicMetadata.role`. Convex verifies the token signature on every call.

- **For**: no role column to keep in sync, no window where the database and identity provider disagree, and promotion requires the Clerk secret key.
- **Against**: a role change takes effect when the token refreshes (the template lifetime is 60 seconds), and Convex cannot list "all admins" itself.

The Trusted Lender badge is different. It is application data that should update live on other people's screens, so it sits on the Convex `users` row and is only writable through an admin mutation.

### 3. One choke point for loan status changes

All transitions go through `setRequestStatus` (`convex/lib/loans.ts`), which patches the request, keeps the tool's availability flag in step, and queues the notification, all inside the same transaction. A mutation either does all of it or none.

Each mutation checks the current status before moving on (`requested → accepted | rejected | cancelled`, `accepted → returned | overdue`, `overdue → returned`). Convex mutations are serialisable, so two owners' clicks or a double submit cannot both accept the same request.

### 4. Denormalised availability

`tools.status` (`available` / `on_loan`) is stored rather than derived, so the public landing query reads one table and never touches requests. The cost is that it must be maintained, which is why decision 3 matters.

### 5. Soft-deleted listings

Deleting a tool sets `deletedAt` so historical loans still show what was borrowed. Pending requests on it are auto-declined (and the borrowers notified). An owner cannot delete a tool that is out on loan; an admin can, and the loan remains closable.

### 6. Notifications are decoupled from user actions

Mutations do not call n8n. They schedule an internal action that runs after commit, signs the payload and POSTs it, retrying with backoff. If n8n is down, the user's action still succeeds. Delivery is at-least-once, so each event carries a stable `eventId` and workflow 1 drops repeats.

### 7. Signed, replay-resistant machine endpoints

n8n and Convex authenticate each other with HMAC-SHA256 over a timestamp plus the payload. Inbound requests to Convex also sign the method and path, so a captured signature for the read endpoint cannot be replayed against the write endpoint. Verification uses `crypto.subtle.verify`, which compares in constant time. Requests older than five minutes are refused.

### 8. Idempotent overdue write-back

The daily job's write is keyed on `(requestId, runDate)`, stored as `lastReminderDate`. Replays return `already_processed`. A loan returned between the read and the write returns `not_overdue` and is left untouched. The overdue transition deliberately does not fire the status webhook, because the reminder itself is the notification.

### 9. Minimal public surface

`tools.listPublic` maps rows to exactly `{ _id, name, category, available }` before returning. Owner, description and photo never leave the backend for anonymous callers, rather than being fetched and hidden.

## What changes at 100k+ users

### Data access

- **Paginate everything.** Browse, My Listings and the request lists currently `take(200)`. They would move to `usePaginatedQuery` with cursor pagination, as the admin tables already do.
- **Stop joining per row.** `enrichRequest` does three `db.get` calls per request. Denormalise the tool name and counterparty names onto the request (they are needed on every render), and keep them fresh with a trigger on rename.
- **Search and geography.** A flat list stops being useful well before 100k tools. Add a Convex search index on name and description, and a neighbourhood key (geohash or postcode district) leading the browse index so users see nearby tools.
- **Overdue job batching.** `overdue.listDue` reads up to 500 rows per status in one call. At scale it would page through the `by_status_end_date` index with a cursor, and workflow 2 would loop over pages. The overdue check could also move into a Convex cron, leaving n8n to deliver only.

### Scheduling model

- **Real bookings.** Replace "one active loan per tool" with a bookings table and an interval-overlap check per tool, so a tool can be reserved for future dates while out on loan. Availability then becomes a function of date instead of a flag.
- **Time zones.** Store the neighbourhood's time zone and compute "overdue" in local time instead of UTC.

### Notifications and n8n

- **Transactional outbox.** Write each event to an `outbox` table in the mutation, deliver from there, and record attempts. That gives a dead-letter queue, replay after an outage, and visibility that the current "log after five failures" approach lacks.
- **n8n in queue mode.** Run n8n with Redis-backed workers and a separate webhook process so bursts of status changes do not queue behind long executions. Raw-body signature verification would replace re-serialising the parsed JSON.
- **User preferences.** Per-user channel and quiet-hours settings, digesting, and unsubscribe handling before sending real email or SMS.
- **Secret rotation.** Accept two HMAC secrets during a rotation window and add a key id header.

### Security and abuse

- **Rate limiting** on listing creation, borrow requests and uploads (the Convex rate-limiter component), keyed by user.
- **Upload validation.** Check content type and size server-side, tie each storage id to the uploader, and delete orphaned or replaced files. Today any signed-in user can obtain an upload URL and old photos are never cleaned up.
- **Moderation.** Reporting, listing review queues, and suspension, since admin removal by hand does not scale.
- **Admin model.** Move from a single `admin` role to scoped permissions (moderator, support, super-admin), most likely with Clerk Organizations or a permissions claim, and surface the audit log in the UI.
- **Clerk webhooks.** Sync user updates and deletions from Clerk instead of only upserting on sign-in, so profile changes and account deletion propagate (and personal data can be erased on request).

### Operations

- **Tests.** Unit tests for the permission matrix and the status state machine with `convex-test`, and Playwright flows for borrow, accept and return across two accounts. Run both in CI with typecheck and lint.
- **Observability.** Ship Convex logs to a log platform, alert on notification failures and on the overdue job not running, and track webhook latency.
- **Environments.** Separate Clerk and Convex instances for staging and production, with preview deployments per pull request.
- **Schema migrations.** Use staged, backfilled migrations (the Convex migrations component) rather than editing the schema in place.
- **Cost and limits.** Watch Convex function and bandwidth usage on the landing page in particular; it is public, unauthenticated and subscribed live, so it is the first candidate for a cached, non-reactive read.
