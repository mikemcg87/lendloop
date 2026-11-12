import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";

const BATCH = 500;

// The idempotency key n8n reports a day's reminder under (workflow 2,
// "Build activity report"). Its presence means that reminder was delivered.
export const reminderKey = (requestId: string, runDate: string) =>
  `${requestId}:reminder:${runDate}`;

async function delivered(ctx: QueryCtx, requestId: string, runDate: string) {
  const event = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("key", reminderKey(requestId, runDate)))
    .first();
  return event !== null;
}

// Loans that need a reminder on `today`: accepted loans past their end date
// plus loans already marked overdue, minus any whose reminder for today has
// been delivered. A loan claimed today with no delivery on record stays in
// the list, so a run that died between claiming and sending is picked up.
// Returns only what the reminder needs: the borrower's contact, the tool and
// owner names, and the due date.
export const listDue = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const [newlyOverdue, stillOverdue] = await Promise.all([
      ctx.db
        .query("requests")
        .withIndex("by_status_end_date", (q) =>
          q.eq("status", "accepted").lt("endDate", today),
        )
        .take(BATCH),
      ctx.db
        .query("requests")
        .withIndex("by_status_end_date", (q) => q.eq("status", "overdue"))
        .take(BATCH),
    ]);
    const candidates = [...newlyOverdue, ...stillOverdue];
    const pending = await Promise.all(
      candidates.map(
        async (request) =>
          request.lastReminderDate !== today ||
          !(await delivered(ctx, request._id, today)),
      ),
    );
    const due = candidates.filter((_, index) => pending[index]);
    return await Promise.all(
      due.map(async (request) => {
        const [tool, owner, borrower] = await Promise.all([
          ctx.db.get(request.toolId),
          ctx.db.get(request.ownerId),
          ctx.db.get(request.borrowerId),
        ]);
        return {
          requestId: request._id,
          runDate: today,
          endDate: request.endDate,
          toolName: tool?.name ?? "a tool",
          ownerName: owner?.name ?? "your neighbour",
          borrower: { name: borrower?.name ?? "", email: borrower?.email },
        };
      }),
    );
  },
});

// Claims a day's reminder for a loan and flips it to overdue. Once n8n has
// reported the delivery, further claims for that day are refused, so a re-run
// sends nothing. Until then the same day's claim can be taken again
// ("resumed"): if the claim was stored but its response never reached n8n,
// or the send failed, the retry still sends. That is at-least-once delivery:
// a rare duplicate is possible, a silently skipped reminder is not.
// A loan returned in the meantime is left alone.
export const claimReminder = internalMutation({
  args: { requestId: v.string(), runDate: v.string() },
  handler: async (ctx, { requestId, runDate }) => {
    const id = ctx.db.normalizeId("requests", requestId);
    const request = id && (await ctx.db.get(id));
    if (!request) return { claimed: false, result: "not_found" as const };
    // ">=" rather than "===": a late call for an earlier day must not move
    // the marker backwards and reopen today's reminder.
    if (
      request.lastReminderDate !== undefined &&
      request.lastReminderDate >= runDate
    ) {
      const resumable =
        request.lastReminderDate === runDate &&
        request.status === "overdue" &&
        !(await delivered(ctx, request._id, runDate));
      return resumable
        ? { claimed: true, result: "resumed" as const }
        : { claimed: false, result: "already_claimed" as const };
    }
    if (request.status === "accepted" && request.endDate < runDate) {
      await ctx.db.patch(request._id, {
        status: "overdue",
        lastReminderDate: runDate,
      });
      return { claimed: true, result: "marked_overdue" as const };
    }
    if (request.status === "overdue") {
      await ctx.db.patch(request._id, { lastReminderDate: runDate });
      return { claimed: true, result: "still_overdue" as const };
    }
    return { claimed: false, result: "not_overdue" as const };
  },
});
