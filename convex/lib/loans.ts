import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ACTIVE_LOAN_STATUSES, type RequestStatus } from "./domain";

// Single choke point for status changes: every transition patches the row,
// keeps the tool's availability in sync, and queues the n8n notification.
export async function setRequestStatus(
  ctx: MutationCtx,
  request: Doc<"requests">,
  status: RequestStatus,
) {
  const now = Date.now();
  await ctx.db.patch(request._id, {
    status,
    ...(status === "returned" ? { returnedAt: now } : {}),
    ...(status === "accepted" || status === "rejected" || status === "cancelled"
      ? { decidedAt: now }
      : {}),
  });
  if (status === "accepted") {
    await ctx.db.patch(request.toolId, { status: "on_loan" });
  } else if (status === "returned") {
    await ctx.db.patch(request.toolId, { status: "available" });
  }
  await notify(ctx, request._id, status);
}

export async function notify(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  event: RequestStatus,
) {
  await ctx.scheduler.runAfter(0, internal.notifications.dispatch, {
    requestId,
    event,
    attempt: 0,
  });
}

export async function hasActiveLoan(ctx: QueryCtx, toolId: Id<"tools">) {
  for (const status of ACTIVE_LOAN_STATUSES) {
    const loan = await ctx.db
      .query("requests")
      .withIndex("by_tool_status", (q) =>
        q.eq("toolId", toolId).eq("status", status),
      )
      .first();
    if (loan) return true;
  }
  return false;
}

// Soft-deletes a listing and declines anything still pending against it.
// Authorisation is the caller's job (owner in tools.remove, admin in
// admin.removeListing).
export async function archiveTool(
  ctx: MutationCtx,
  tool: Doc<"tools">,
  actorId: Id<"users">,
) {
  await ctx.db.patch(tool._id, { deletedAt: Date.now(), deletedBy: actorId });
  const pending = await ctx.db
    .query("requests")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", tool._id).eq("status", "requested"),
    )
    .collect();
  for (const request of pending) {
    await setRequestStatus(ctx, request, "rejected");
  }
}

export async function enrichRequest(ctx: QueryCtx, request: Doc<"requests">) {
  const [tool, owner, borrower, activity] = await Promise.all([
    ctx.db.get(request.toolId),
    ctx.db.get(request.ownerId),
    ctx.db.get(request.borrowerId),
    ctx.db
      .query("automationEvents")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .order("desc")
      .take(40),
  ]);
  return {
    // Most recent deliveries reported back by n8n, newest first.
    activity: activity.map((event) => ({
      kind: event.kind,
      status: event.status,
      at: event._creationTime,
    })),
    _id: request._id,
    _creationTime: request._creationTime,
    status: request.status,
    startDate: request.startDate,
    endDate: request.endDate,
    decidedAt: request.decidedAt,
    returnedAt: request.returnedAt,
    returnNote: request.returnNote,
    tool: tool && {
      _id: tool._id,
      name: tool.name,
      category: tool.category,
      removed: tool.deletedAt !== undefined,
    },
    owner: owner && {
      _id: owner._id,
      name: owner.name,
      trustedLender: owner.trustedLender,
    },
    borrower: borrower && { _id: borrower._id, name: borrower.name },
  };
}
