import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const BATCH = 500;

// Loans that need a reminder on `today`: accepted loans past their end date
// plus loans already marked overdue, minus any already claimed today.
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
    const due = [...newlyOverdue, ...stillOverdue].filter(
      (request) => request.lastReminderDate !== today,
    );
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

// Claims a day's reminder for a loan and flips it to overdue. Only the first
// call for a loan and day returns `claimed: true`, so a retried or re-run
// workflow never sends a second reminder for the same day.
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
      return { claimed: false, result: "already_claimed" as const };
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
