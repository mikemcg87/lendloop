import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const BATCH = 500;

// Loans that need a reminder on `today`: accepted loans past their end date
// plus loans already marked overdue, minus any already reminded today.
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
    const due = [...newlyOverdue, ...stillOverdue].filter(
      (request) => request.lastReminderDate !== today,
    );
    return await Promise.all(
      due.map(async (request: Doc<"requests">) => {
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
          owner: { name: owner?.name, email: owner?.email },
          borrower: { name: borrower?.name, email: borrower?.email },
        };
      }),
    );
  },
});

// Idempotent per (requestId, runDate): replaying the same write-back is a
// no-op, and a loan that was returned in the meantime is left alone.
export const mark = internalMutation({
  args: { requestId: v.string(), runDate: v.string() },
  handler: async (ctx, { requestId, runDate }) => {
    const id = ctx.db.normalizeId("requests", requestId);
    const request = id && (await ctx.db.get(id));
    if (!request) return "not_found" as const;
    if (request.lastReminderDate === runDate) return "already_processed" as const;

    if (request.status === "accepted" && request.endDate < runDate) {
      await ctx.db.patch(request._id, {
        status: "overdue",
        lastReminderDate: runDate,
      });
      return "marked_overdue" as const;
    }
    if (request.status === "overdue") {
      await ctx.db.patch(request._id, { lastReminderDate: runDate });
      return "reminder_recorded" as const;
    }
    return "not_overdue" as const;
  },
});
