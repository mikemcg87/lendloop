import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { assertOwner, requireUser, type Session } from "./lib/auth";
import {
  enrichRequest,
  hasActiveLoan,
  notify,
  setRequestStatus,
} from "./lib/loans";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function assertIsoDate(value: string) {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ConvexError("Dates must be valid YYYY-MM-DD values.");
  }
}

export const create = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);

    assertIsoDate(args.startDate);
    assertIsoDate(args.endDate);
    if (args.endDate < args.startDate) {
      throw new ConvexError("The end date must be on or after the start date.");
    }
    // The server runs in UTC; allow one day of slack for the caller's timezone.
    const earliest = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
    if (args.startDate < earliest) {
      throw new ConvexError("The start date cannot be in the past.");
    }

    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.deletedAt !== undefined) {
      throw new ConvexError("Listing not found.");
    }
    if (tool.ownerId === user._id) {
      throw new ConvexError("You cannot borrow your own tool.");
    }
    const pending = await ctx.db
      .query("requests")
      .withIndex("by_tool_status", (q) =>
        q.eq("toolId", tool._id).eq("status", "requested"),
      )
      .collect();
    if (pending.some((request) => request.borrowerId === user._id)) {
      throw new ConvexError("You already have a pending request for this tool.");
    }

    const requestId = await ctx.db.insert("requests", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: user._id,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "requested",
    });
    await notify(ctx, requestId, "requested");
    return requestId;
  },
});

// Requests I made as a borrower.
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .order("desc")
      .take(200);
    return await Promise.all(requests.map((r) => enrichRequest(ctx, r)));
  },
});

// Requests other people made for my tools.
export const listIncoming = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(200);
    return await Promise.all(requests.map((r) => enrichRequest(ctx, r)));
  },
});

async function getRequest(ctx: MutationCtx, requestId: Id<"requests">) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new ConvexError("Request not found.");
  return request;
}

async function getRequestAsOwner(
  ctx: MutationCtx,
  session: Session,
  requestId: Id<"requests">,
) {
  const request = await getRequest(ctx, requestId);
  assertOwner(session, request.ownerId);
  return request;
}

export const respond = mutation({
  args: {
    requestId: v.id("requests"),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    const session = await requireUser(ctx);
    const request = await getRequestAsOwner(ctx, session, args.requestId);
    if (request.status !== "requested") {
      throw new ConvexError("This request has already been handled.");
    }
    if (
      args.decision === "accepted" &&
      (await hasActiveLoan(ctx, request.toolId))
    ) {
      throw new ConvexError(
        "This tool is already out on loan. Mark it returned first.",
      );
    }
    await setRequestStatus(ctx, request, args.decision);
  },
});

export const markReturned = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const session = await requireUser(ctx);
    const request = await getRequestAsOwner(ctx, session, args.requestId);
    if (request.status !== "accepted" && request.status !== "overdue") {
      throw new ConvexError("Only an active loan can be marked returned.");
    }
    await setRequestStatus(ctx, request, "returned");
  },
});

export const cancel = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const session = await requireUser(ctx);
    const request = await getRequest(ctx, args.requestId);
    if (request.borrowerId !== session.user._id) {
      throw new ConvexError("You can only cancel your own requests.");
    }
    if (request.status !== "requested") {
      throw new ConvexError("Only a pending request can be cancelled.");
    }
    await setRequestStatus(ctx, request, "cancelled");
  },
});
