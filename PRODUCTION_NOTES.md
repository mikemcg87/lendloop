# What I would change to run this in production

LendLoop as submitted is a working take-home: access control enforced on the server, a tested backend and automation that has been run end to end. It is not production-ready. This note lists what I would change, most important first, and why.

## 1. Before any real user touches it

**Environments and secrets.** Separate Clerk, Convex and n8n instances for staging and production. Secrets in a secrets manager rather than `.env` files, with the HMAC secret rotated on a schedule: the endpoints would accept two secrets during a rotation window, identified by a key-id header.

**Move the HMAC secret into an n8n credential.** The AWS key for SES already lives in n8n's encrypted credential store. The shared HMAC secret is read with `$env`, which keeps it out of the exported JSON and makes the docker-compose setup one command. On n8n Cloud, or with env access disabled, I would move it into a credential as well.

**Email from a domain I control.** SES is in sandbox mode and the sender is a single verified address. Production needs a verified domain with DKIM, SPF and DMARC, SES production access, and bounce and complaint handling wired back to the user record.

**Content-Security-Policy.** The app sets the baseline response headers but no CSP, because Clerk and Convex need per-deployment origins. I would add a nonce-based policy in the proxy, start it in report-only mode, and enforce it once the reports are clean.

**Rate limiting and abuse controls.** Per-user limits on creating listings, sending borrow requests and requesting upload URLs (Convex's rate-limiter component). Today a signed-in user can do all three without limit.

**Upload hardening.** A photo's type and size are checked when it is attached to a listing. I would also tie each stored file to its uploader, delete replaced or orphaned files, and move photos to S3 behind presigned URLs with the limits enforced by the upload policy itself, so an oversized file is refused before it is stored.

**Account lifecycle.** Sync user updates and deletions from Clerk by webhook instead of only upserting on sign-in, so a deleted account is removed or anonymised in Convex and profile changes propagate.

**Retention.** Soft-deleted listings, finished loans and automation events are kept indefinitely. Production needs a stated retention period and a scheduled job that enforces it.

## 2. Reliability of the automation

**Transactional outbox for notifications.** Convex currently retries the webhook five times and then records the failure on the loan. I would write each event to an `outbox` table inside the mutation and deliver from there, recording attempts. That gives a dead-letter queue, replay after an n8n outage, and a place to see what is stuck.

**Close the at-most-once gap on reminders.** A reminder is claimed before it is sent so that retries cannot duplicate it. If the send then fails for good, that day's reminder is lost until tomorrow's run (the error workflow reports it). With an outbox, a failed send would release its claim and be retried safely.

**Isolate a failing loan.** The overdue job handles loans one at a time, so a retry never repeats a loan that already succeeded. A loan that still fails stops the run, and the loans behind it wait for the next day. I would route a failed loan to an error branch and carry on with the rest.

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

- CI already runs lint, the type check, the tests and `npm audit` on every push. I would add preview deployments and a production build to it.
- Playwright tests for the flows the backend tests cannot see: sign-in, borrow, approve and return across two accounts.
- Dependency and secret scanning, and pinned image digests for n8n.
- The n8n workflows exported from the running instance by a CI job, so the JSON in the repository cannot drift from what is deployed.

## 7. If this handled sensitive data

LendLoop is deliberately unrelated to healthcare, but the same design carries over to a clinical product, and these are the places I would tighten first:

- **Minimum necessary, enforced at the query.** The pattern used for the public page and the webhook payloads (return only the fields the consumer needs, decided on the server) is the right default for patient data. I would add tests that fail when a response gains a field, as the public-feed test does here.
- **No sensitive data in the automation layer.** n8n stores execution data. For protected health information I would send it an opaque reference and have the notifier fetch the minimum it needs at send time, or keep the content out of n8n entirely and disable execution-data saving for those workflows.
- **Audit reads, not only writes.** Record who viewed which record, immutably, and review it.
- **Encryption and agreements.** Encryption in transit and at rest is table stakes; the real work is confirming every processor in the path (auth, database, automation, notification provider) is covered by the necessary agreement and data-residency requirement before any real data flows.
