import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { requestStatusValidator } from "./lib/domain";
import { archiveTool, enrichRequest } from "./lib/loans";

// Every function in this file starts with requireAdmin(ctx), which checks the
// role claim on the verified Clerk JWT. Hiding the admin UI is cosmetic.

export const listLoans = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(requestStatusValidator),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { status } = args;
    const result = status
      ? await ctx.db
          .query("requests")
          .withIndex("by_status_end_date", (q) => q.eq("status", status))
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("requests")
          .order("desc")
          .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(result.page.map((r) => enrichRequest(ctx, r))),
    };
  },
});

export const listUsers = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const result = await ctx.db
      .query("users")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((user) => ({
        _id: user._id,
        name: user.name,
        // A public demo hands out its admin login, so it must not show the
        // addresses of the people who signed up.
        email: process.env.DEMO_MODE ? undefined : user.email,
        imageUrl: user.imageUrl,
        trustedLender: user.trustedLender,
      })),
    };
  },
});

export const removeListing = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const { user } = await requireAdmin(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.deletedAt !== undefined) {
      throw new ConvexError("Listing not found.");
    }
    // An active loan stays in the history and can still be marked returned.
    await archiveTool(ctx, tool, user._id);
    await ctx.db.insert("adminAuditLog", {
      actorId: user._id,
      action: "remove_listing",
      targetId: tool._id,
    });
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found.");
    if (target.trustedLender === args.trusted) return;
    await ctx.db.patch(target._id, { trustedLender: args.trusted });
    await ctx.db.insert("adminAuditLog", {
      actorId: user._id,
      action: args.trusted ? "grant_trusted_lender" : "revoke_trusted_lender",
      targetId: target._id,
    });
  },
});
