# What I would change to run this in production

LendLoop as submitted is a working take-home, not a production system. This is what I would change, most important first.

## Before any real user touches it

- **Environments and secrets.** Separate Clerk, Convex and n8n instances for staging and production, secrets in a secrets manager, and the HMAC secret rotated on a schedule (two secrets accepted during a rotation window, identified by a key-id header). On n8n Cloud the HMAC secret would move from `$env` into a credential, as the AWS key already is.
- **Rate limiting.** Per-user limits on creating listings, sending requests and requesting upload URLs. Today a signed-in user can do all three without limit.
- **Upload hardening.** Tie each stored file to its uploader at upload time, delete replaced and orphaned files, and move photos to S3 behind presigned URLs so an oversized file is refused before it is stored.
- **Content-Security-Policy.** A nonce-based policy, in report-only mode first. The other baseline headers are already set.
- **Email from a verified domain,** with DKIM, SPF and DMARC, SES production access, and bounce handling.
- **Account lifecycle and retention.** Sync deletions from Clerk by webhook, and give soft-deleted listings, finished loans and automation events a stated retention period that a scheduled job enforces.

## Reliability of the automation

- **A transactional outbox for notifications.** Write each event to an `outbox` table inside the mutation and deliver from there, with a pending state that is cleared only by n8n's delivery report. That closes the gap the README describes, where n8n acknowledges a webhook and then fails, and gives a dead-letter queue and replay after an outage.
- **Provider-side idempotency keys** on the sends, so the at-least-once reminder cannot become a visible duplicate.
- **Isolate a failing loan** in the overdue job, so one bad loan does not hold up the ones behind it, and page the job past its 500-loan read.
- **Alert when the daily job has not run.** A schedule that silently stops produces no errors at all.
- **n8n in queue mode** with Postgres, a separate webhook process and execution data pruned on a schedule.

## Product and scale

- **Real bookings.** Replace "one active loan per tool" with a bookings table and an overlap check, so a tool can be reserved while it is out.
- **Local time.** Compute "overdue" in the neighbourhood's time zone, not UTC.
- **Paginate every list and stop joining per row,** by denormalising names onto the request. Add search and a neighbourhood key to the browse index.
- **Moderation and finer-grained roles** than a single `admin`.

## Engineering process

- Playwright tests for the flows the backend tests cannot see: sign-in, borrow, approve and return across two accounts, and a clean-volume n8n import.
- Observability: structured logs, error tracking, and a correlation id carried from the Convex mutation through the n8n execution to the activity record.
- Staged schema migrations, pinned image digests for n8n, and the workflow JSON exported from the running instance by CI so it cannot drift.

## If this handled sensitive data

n8n stores execution data, so for anything sensitive I would send it an opaque reference and have the notifier fetch the minimum at send time. I would also audit reads as well as writes, and add tests that fail when a response gains a field, as the public-feed test does here.
