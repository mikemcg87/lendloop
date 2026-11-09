import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { automationKindValidator, requestStatusValidator } from "./lib/domain";

// Records that n8n delivered something for a loan. Idempotent on `key`, so a
// retried write-back never creates a second row.
export const record = internalMutation({
  args: {
    requestId: v.string(),
    kind: automationKindValidator,
    key: v.string(),
    status: v.optional(requestStatusValidator),
  },
  handler: async (ctx, args) => {
    const requestId = ctx.db.normalizeId("requests", args.requestId);
    if (!requestId || !(await ctx.db.get(requestId))) {
      return "not_found" as const;
    }
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) return "already_recorded" as const;
    await ctx.db.insert("automationEvents", {
      requestId,
      kind: args.kind,
      key: args.key,
      status: args.status,
    });
    return "recorded" as const;
  },
});
