import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  automationKindValidator,
  categoryValidator,
  conditionValidator,
  requestStatusValidator,
} from "./lib/domain";

export default defineSchema({
  // Mirror of the Clerk user, upserted on sign-in. The role is deliberately
  // NOT stored here: it is read from the verified JWT on every call.
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    // Flipped transactionally when a loan is accepted / returned.
    status: v.union(v.literal("available"), v.literal("on_loan")),
    // Soft delete so loan history keeps a readable tool reference.
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_deleted_category", ["deletedAt", "category"]),

  requests: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    // Calendar dates, "YYYY-MM-DD" (sort lexicographically).
    startDate: v.string(),
    endDate: v.string(),
    status: requestStatusValidator,
    returnedAt: v.optional(v.number()),
    // Date of the last overdue reminder, written by the n8n daily job. Makes
    // the write-back idempotent per (request, day).
    lastReminderDate: v.optional(v.string()),
  })
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_tool_status", ["toolId", "status"])
    .index("by_status_end_date", ["status", "endDate"]),

  // Deliveries reported back by n8n, shown on each loan ("Reminder sent 2
  // days ago"). `key` is the idempotency key: one row per key, ever.
  automationEvents: defineTable({
    requestId: v.id("requests"),
    kind: automationKindValidator,
    key: v.string(),
    // For notification_sent: which status change was announced.
    status: v.optional(requestStatusValidator),
  })
    .index("by_key", ["key"])
    .index("by_request", ["requestId"]),

  adminAuditLog: defineTable({
    actorId: v.id("users"),
    action: v.union(
      v.literal("remove_listing"),
      v.literal("grant_trusted_lender"),
      v.literal("revoke_trusted_lender"),
    ),
    targetId: v.string(),
  }),
});
