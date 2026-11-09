# What I would change to run this in production

LendLoop as submitted is a working take-home: correct access control, a tested backend and automation that has been run end to end. It is not production-ready. This note lists what I would change, most important first, and why.

## 1. Before any real user touches it

**Environments and secrets.** Separate Clerk, Convex and n8n instances for staging and production. Secrets in a secrets manager rather than `.env` files, with the HMAC secret rotated on a schedule: the endpoints would accept two secrets during a rotation window, identified by a key-id header.

**Move n8n secrets into n8n credentials.** The workflows read the shared secret with `$env`, which keeps it out of the exported JSON and makes the docker-compose setup one command. On n8n Cloud, or with env access disabled, I would switch the Crypto nodes to n8n's encrypted credential store and put the notification provider's token in a credential too.

**Rate limiting and abuse controls.** Per-user limits on creating listings, sending borrow requests and requesting upload URLs (Convex's rate-limiter component). Today a signed-in user can do all three without limit.

**Upload hardening.** Validate content type and size server-side, tie each stored file to its uploader, and delete replaced or orphaned files. Currently any signed-in user can obtain an upload URL and old photos are never cleaned up.

**Account lifecycle.** Sync user updates and deletions from Clerk by webhook instead of only upserting on sign-in, so a deleted account is removed or anonymised in Convex and profile changes propagate.

**Retention.** Soft-deleted listings, finished loans and automation events are kept indefinitely. Production needs a stated retention period and a scheduled job that enforces it.

## 2. Reliability of the automation

**Transactional outbox for notifications.** Convex currently retries the webhook five times and then logs the failure. I would write each event to an `outbox` table inside the mutation and deliver from there, recording attempts. That gives a dead-letter queue, replay after an n8n outage, and a place to see what is stuck.

**Close the at-most-once gap on reminders.** A reminder is claimed before it is sent so that retries cannot duplicate it. If the send then fails for good, that day's reminder is lost until tomorrow's run (the error workflow reports it). With an outbox, a failed send would release its claim and be retried safely.

**n8n in queue mode.** Redis-backed workers and a separate webhook process, so a burst of status changes does not queue behind long executions, with Postgres instead of SQLite and execution data pruned on a schedule.

**Page the overdue job.** `/n8n/overdue-loans` returns up to 500 loans per status in one response. At volume it would page through the index with a cursor, and the workflow would loop over pages in batches.

**Alerting that reaches a person.** The error workflow posts to a URL. In production that is an on-call channel, plus an alert if the daily job has *not* run, since a schedule that silently stops produces no errors at all.

## 3. Observability

- Structured logs from Convex shipped to a log platform (Datadog), with errors in Sentry for the Next.js app.
- Metrics on webhook latency, retry counts, notification failure rate and overdue-job duration.
- A correlation id carried from the Convex mutation through the n8n execution to the activity record, so one loan event can be traced across both systems.
- The admin audit log surfaced in the UI and exported to immutable storage.

## 4. Product correctness

**Real bookings.** Replace "one active loan per tool" with a bookings table and an interval-overlap check, so a tool can be reserved for future dates while it is out. Availability becomes a function of date rather than a flag.

**Time zones.** Store each neighbourhood's time zone and compute "overdue" in local time, not UTC.

**Notification preferences.** Per-user channel choice, quiet hours, digests and unsubscribe handling before sending real email or SMS.

**Moderation.** Reporting, a review queue and account suspension. Removing listings by hand does not scale.

**Finer-grained roles.** Split the single `admin` role into scoped permissions (moderator, support, super-admin) carried as a permissions claim, with every privileged read logged as well as every write.

## 5. Scaling to 100k+ users

**Paginate every list.** Browse, My Listings and the request views currently load up to 200 rows. They would move to cursor pagination, as the admin tables already do.

**Stop joining per row.** Each request is enriched with three document reads plus an activity lookup. I would denormalise the tool name and both parties' display names onto the request, and keep a "latest activity" summary on it.

**Search and locality.** A flat list stops being useful long before 100k tools. Add a search index on name and description, and a neighbourhood key leading the browse index so people see what is near them.

**Cache the public page.** It is unauthenticated and subscribed live, which makes it the most expensive read per visitor. It would become a cached, periodically revalidated query.

**Schema migrations.** Staged, backfilled migrations (the Convex migrations component) instead of editing the schema in place, which is what adding the `condition` field did during development.

## 6. Engineering process

- CI running typecheck, lint and the test suite on every pull request, with preview deployments.
- Playwright tests for the flows the backend tests cannot see: sign-in, borrow, approve and return across two accounts.
- Dependency and secret scanning, and pinned image digests for n8n.
- The n8n workflows exported from the running instance by a CI job, so the JSON in the repository cannot drift from what is deployed.

## 7. If this handled sensitive data

LendLoop is deliberately unrelated to healthcare, but the same design carries over to a clinical product, and these are the places I would tighten first:

- **Minimum necessary, enforced at the query.** The pattern used for the public page and the webhook payloads (return only the fields the consumer needs, decided on the server) is the right default for patient data. I would add tests that fail when a response gains a field, as the public-feed test does here.
- **No sensitive data in the automation layer.** n8n stores execution data. For protected health information I would send it an opaque reference and have the notifier fetch the minimum it needs at send time, or keep the content out of n8n entirely and disable execution-data saving for those workflows.
- **Audit reads, not only writes.** Record who viewed which record, immutably, and review it.
- **Encryption and agreements.** Encryption in transit and at rest is table stakes; the real work is confirming every processor in the path (auth, database, automation, notification provider) is covered by the necessary agreement and data-residency requirement before any real data flows.
