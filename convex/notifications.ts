import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { requestStatusValidator } from "./lib/domain";
import { sign } from "./lib/hmac";

const MAX_ATTEMPTS = 5;

type Payload = {
  eventId: string;
  event: string;
  occurredAt: number;
  request: { id: string; startDate: string; endDate: string };
  tool: { id: string; name: string } | null;
  owner: { name: string; email?: string } | null;
  borrower: { name: string; email?: string } | null;
};

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
    return {
      // Each status is reached at most once per request, so this is a stable
      // idempotency key for the receiver across retries.
      eventId: `${request._id}:${args.event}`,
      event: args.event,
      occurredAt: Date.now(),
      request: {
        id: request._id,
        startDate: request.startDate,
        endDate: request.endDate,
      },
      tool: tool && { id: tool._id, name: tool.name },
      owner: owner && { name: owner.name, email: owner.email },
      borrower: borrower && { name: borrower.name, email: borrower.email },
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

    const body = JSON.stringify(data);
    const timestamp = Date.now().toString();
    let failure: string | null = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LendLoop-Timestamp": timestamp,
          "X-LendLoop-Signature": await sign(secret, `${timestamp}.${body}`),
          "X-LendLoop-Event-Id": data.eventId,
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
