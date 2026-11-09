import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Role = "admin" | "user";

type Ctx = QueryCtx | MutationCtx;

export type Session = {
  identity: UserIdentity;
  user: Doc<"users">;
  role: Role;
};

// The `role` claim comes from the Clerk JWT template
// ("role": "{{user.public_metadata.role}}"). publicMetadata is only writable
// with the Clerk secret key, and Convex has verified the token signature, so
// the claim is trustworthy. Anything other than exactly "admin" is a user.
export function roleFromIdentity(identity: UserIdentity): Role {
  return identity.role === "admin" ? "admin" : "user";
}

export async function getSession(ctx: Ctx): Promise<Session | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) return null;
  return { identity, user, role: roleFromIdentity(identity) };
}

export async function requireUser(ctx: Ctx): Promise<Session> {
  const session = await getSession(ctx);
  if (!session) throw new ConvexError("Sign in required.");
  return session;
}

export async function requireAdmin(ctx: Ctx): Promise<Session> {
  const session = await requireUser(ctx);
  if (session.role !== "admin") throw new ConvexError("Admin access required.");
  return session;
}

export function assertOwner(session: Session, ownerId: Doc<"users">["_id"]) {
  if (session.user._id !== ownerId) {
    throw new ConvexError("You can only do this to your own items.");
  }
}
