import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { AutomationKind, RequestStatus } from "./lib/domain";
import { verify } from "./lib/hmac";

const MAX_SKEW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 200;

const AUTOMATION_KINDS: AutomationKind[] = ["notification_sent", "reminder_sent"];
const STATUSES: RequestStatus[] = [
  "requested",
  "accepted",
  "rejected",
  "cancelled",
  "overdue",
  "returned",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Machine-to-machine auth for n8n. The caller signs
//   `${timestamp}.${METHOD}.${pathname}.${rawBody}`
// with the shared secret (hex HMAC-SHA256). Binding the method and path stops
// a signature for one endpoint being replayed against another; the timestamp
// window stops old requests being replayed at all.
// Returns an error Response, or null when the request is authentic.
async function rejectUnlessSigned(request: Request, rawBody: string) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return json({ error: "Webhook secret not configured." }, 503);

  const timestamp = request.headers.get("X-LendLoop-Timestamp") ?? "";
  const signature = request.headers.get("X-LendLoop-Signature") ?? "";
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_SKEW_MS) {
    return json({ error: "Missing or stale timestamp." }, 401);
  }
  const { pathname } = new URL(request.url);
  const message = `${timestamp}.${request.method}.${pathname}.${rawBody}`;
  if (!(await verify(secret, message, signature))) {
    return json({ error: "Invalid signature." }, 401);
  }
  return null;
}

// Verifies the signature over the raw bytes first, then parses. Returns the
// parsed object, or an error Response.
async function readSignedJson(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  const rawBody = await request.text();
  const rejection = await rejectUnlessSigned(request, rawBody);
  if (rejection) return rejection;
  try {
    const body: unknown = JSON.parse(rawBody);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return json({ error: "Body must be a JSON object." }, 400);
}

const http = httpRouter();

// Step 1 of the daily job: loans that need an overdue reminder today.
http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const rejection = await rejectUnlessSigned(request, "");
    if (rejection) return rejection;
    const loans = await ctx.runQuery(internal.overdue.listDue, {
      today: utcDate(Date.now()),
    });
    return json({ loans });
  }),
});

// Step 2: claim today's reminder for one loan (and mark it overdue) BEFORE
// sending, so retries and re-runs cannot produce a duplicate reminder.
http.route({
  path: "/n8n/claim-reminder",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readSignedJson(request);
    if (body instanceof Response) return body;
    const { requestId, runDate } = body;
    // runDate comes from /n8n/overdue-loans; allow yesterday so a run that
    // straddles midnight UTC can still claim.
    const now = Date.now();
    if (
      typeof requestId !== "string" ||
      typeof runDate !== "string" ||
      (runDate !== utcDate(now) && runDate !== utcDate(now - DAY_MS))
    ) {
      return json({ error: "Expected { requestId, runDate }." }, 400);
    }
    return json(
      await ctx.runMutation(internal.overdue.claimReminder, {
        requestId,
        runDate,
      }),
    );
  }),
});

// Step 3, and the tail of the notification workflow: n8n reports a delivery
// so the app can show "Reminder sent 2 days ago" on the loan.
http.route({
  path: "/n8n/activity",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readSignedJson(request);
    if (body instanceof Response) return body;
    const { requestId, key } = body;
    const kind = AUTOMATION_KINDS.find((k) => k === body.kind);
    const status = STATUSES.find((s) => s === body.status);
    if (
      typeof requestId !== "string" ||
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > MAX_KEY_LENGTH ||
      !kind ||
      (body.status !== undefined && !status)
    ) {
      return json(
        { error: "Expected { requestId, kind, key, status? }." },
        400,
      );
    }
    const result = await ctx.runMutation(internal.automation.record, {
      requestId,
      kind,
      key,
      status,
    });
    return json({ result });
  }),
});

export default http;
