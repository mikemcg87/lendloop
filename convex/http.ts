import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { verify } from "./lib/hmac";

const MAX_SKEW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

const http = httpRouter();

// Read by the n8n daily job: loans that need an overdue reminder today.
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

// Write-back from the n8n daily job after a reminder has been sent.
http.route({
  path: "/n8n/mark-overdue",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const rejection = await rejectUnlessSigned(request, rawBody);
    if (rejection) return rejection;

    let body: { requestId?: unknown; runDate?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }
    const { requestId, runDate } = body;
    // runDate comes from /n8n/overdue-loans; allow yesterday so a run that
    // straddles midnight UTC can still write back.
    const now = Date.now();
    if (
      typeof requestId !== "string" ||
      typeof runDate !== "string" ||
      (runDate !== utcDate(now) && runDate !== utcDate(now - DAY_MS))
    ) {
      return json({ error: "Expected { requestId, runDate }." }, 400);
    }
    const result = await ctx.runMutation(internal.overdue.mark, {
      requestId,
      runDate,
    });
    return json({ requestId, runDate, result });
  }),
});

export default http;
