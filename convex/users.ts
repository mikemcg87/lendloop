import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { getSession } from "./lib/auth";
import { isDemo } from "./lib/demo";

// Called by the client right after sign-in. Everything is taken from the
// verified identity, never from arguments, so a caller can only upsert
// their own row and cannot set trustedLender.
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in required.");

    const profile = {
      clerkId: identity.subject,
      name: identity.name ?? identity.nickname ?? "Neighbour",
      email: identity.email,
      imageUrl: identity.pictureUrl,
    };
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, profile);
      return existing._id;
    }
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      trustedLender: false,
      ...profile,
    });
    // Public demo deployments only: see seed.ts.
    if (isDemo()) {
      await ctx.scheduler.runAfter(0, internal.seed.welcome, { userId });
    }
    return userId;
  },
});

// Null until `store` has run; the UI gates signed-in views on this. `role` is
// returned for showing/hiding admin UI only; the backend re-checks it on
// every admin function.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const session = await getSession(ctx);
    if (!session) return null;
    const { user, role } = session;
    return {
      _id: user._id,
      name: user.name,
      imageUrl: user.imageUrl,
      trustedLender: user.trustedLender,
      role,
    };
  },
});
