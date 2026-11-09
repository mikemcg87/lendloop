import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { requestStatusValidator, type RequestStatus } from "./lib/domain";
import { sign } from "./lib/hmac";

const MAX_ATTEMPTS = 5;

// Everything n8n receives. Deliberately minimal: one recipient, and only the
// other party's display name. No ids beyond the request, no second email.
type Payload = {
  eventId: string;
  event: RequestStatus;
  // Set at send time and covered by the signature, so the receiver can
  // reject replays of an old request.
  sentAt?: number;
  requestId: string;
  recipient: { name: string; email?: string };
  counterpartName: string;
  toolName: string;
  startDate: string;
  endDate: string;
};

// The owner hears about new and withdrawn requests; the borrower hears about
// every decision made on theirs.
const OWNER_IS_RECIPIENT: RequestStatus[] = ["requested", "cancelled"];

export const payload = internalQuery({
  args: { requestId: v.id("requests"), event: requestStatusValidator },
  handler: async (ctx, args): Promise<Payload | null> => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;
    const [tool, owner, borrower] = await Promise.all([
      ctx.db.get(request.toolId),
      ctx.db.get(request.ownerId),
      ctx.db.get(request.borrowerId),
    ]);
    if (!owner || !borrower) return null;
    const toOwner = OWNER_IS_RECIPIENT.includes(args.event);
    const recipient = toOwner ? owner : borrower;
    const counterpart = toOwner ? borrower : owner;
    return {
      // Each status is reached at most once per request, so this is a stable
      // idempotency key for the receiver across retries.
      eventId: `${request._id}:${args.event}`,
      event: args.event,
      requestId: request._id,
      recipient: { name: recipient.name, email: recipient.email },
      counterpartName: counterpart.name,
      toolName: tool?.name ?? "a tool",
      startDate: request.startDate,
      endDate: request.endDate,
    };
  },
});

// Scheduled by setRequestStatus/notify after the mutation commits. Posts a
// signed payload to the n8n webhook and retries with exponential backoff.
export const dispatch = internalAction({
  args: {
    requestId: v.id("requests"),
    event: requestStatusValidator,
    attempt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const url = process.env.N8N_NOTIFY_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      console.warn("n8n webhook not configured; skipping notification.");
      return;
    }
    const data: Payload | null = await ctx.runQuery(
      internal.notifications.payload,
      { requestId: args.requestId, event: args.event },
    );
    if (!data) return;

    // The signature covers the exact bytes sent, so the receiver verifies
    // against the raw body without re-serialising anything.
    const body = JSON.stringify({ ...data, sentAt: Date.now() });
    let failure: string | null = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LendLoop-Signature": await sign(secret, body),
        },
        body,
      });
      if (!response.ok) failure = `HTTP ${response.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (!failure) return;

    const nextAttempt = args.attempt + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
      console.error(`Notification ${data.eventId} failed for good: ${failure}`);
      return;
    }
    console.warn(`Notification ${data.eventId} failed (${failure}); retrying.`);
    await ctx.scheduler.runAfter(
      2 ** nextAttempt * 1000,
      internal.notifications.dispatch,
      { ...args, attempt: nextAttempt },
    );
  },
});
