import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { assertOwner, requireUser } from "./lib/auth";
import {
  categoryValidator,
  conditionValidator,
  type Category,
} from "./lib/domain";
import { archiveTool, hasActiveLoan } from "./lib/loans";

const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;

function cleanFields(name: string, description: string) {
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  if (!trimmedName) throw new ConvexError("Give the tool a name.");
  if (trimmedName.length > NAME_MAX) {
    throw new ConvexError(`Name must be ${NAME_MAX} characters or fewer.`);
  }
  if (trimmedDescription.length > DESCRIPTION_MAX) {
    throw new ConvexError(
      `Description must be ${DESCRIPTION_MAX} characters or fewer.`,
    );
  }
  return { name: trimmedName, description: trimmedDescription };
}

function activeTools(ctx: QueryCtx, category?: Category) {
  // deletedAt is absent on live listings; Convex indexes treat a missing
  // field as `undefined`, so this selects everything not soft-deleted.
  return ctx.db
    .query("tools")
    .withIndex("by_deleted_category", (q) => {
      const live = q.eq("deletedAt", undefined);
      return category ? live.eq("category", category) : live;
    })
    .order("desc")
    .take(200);
}

// Unauthenticated landing-page feed: tools that can be borrowed right now.
// Returns ONLY name and category (plus the id as a list key). No owner,
// description, condition or photo leaves the backend for anonymous callers.
export const listPublic = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, args) => {
    const { category } = args;
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_deleted_category", (q) => {
        const live = q.eq("deletedAt", undefined);
        return category ? live.eq("category", category) : live;
      })
      .filter((q) => q.eq(q.field("status"), "available"))
      .order("desc")
      .take(200);
    return tools.map((tool) => ({
      _id: tool._id,
      name: tool.name,
      category: tool.category,
    }));
  },
});

async function withDetails(ctx: QueryCtx, tool: Doc<"tools">) {
  const [owner, imageUrl] = await Promise.all([
    ctx.db.get(tool.ownerId),
    tool.imageStorageId ? ctx.storage.getUrl(tool.imageStorageId) : null,
  ]);
  return {
    _id: tool._id,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    description: tool.description,
    available: tool.status === "available",
    imageUrl,
    owner: owner && {
      _id: owner._id,
      name: owner.name,
      trustedLender: owner.trustedLender,
    },
  };
}

// Signed-in browse view with full details.
export const browse = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const tools = await activeTools(ctx, args.category);
    return await Promise.all(
      tools.map(async (tool) => ({
        ...(await withDetails(ctx, tool)),
        isMine: tool.ownerId === user._id,
      })),
    );
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
    return await Promise.all(
      tools
        .filter((tool) => tool.deletedAt === undefined)
        .map((tool) => withDetails(ctx, tool)),
    );
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: user._id,
      ...cleanFields(args.name, args.description),
      category: args.category,
      condition: args.condition,
      imageStorageId: args.imageStorageId,
      status: "available",
    });
  },
});

async function getOwnedTool(
  ctx: QueryCtx,
  session: Awaited<ReturnType<typeof requireUser>>,
  toolId: Doc<"tools">["_id"],
) {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.deletedAt !== undefined) {
    throw new ConvexError("Listing not found.");
  }
  assertOwner(session, tool.ownerId);
  return tool;
}

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const session = await requireUser(ctx);
    const tool = await getOwnedTool(ctx, session, args.toolId);
    await ctx.db.patch(tool._id, {
      ...cleanFields(args.name, args.description),
      category: args.category,
      condition: args.condition,
      // Omitting the image keeps the current one.
      ...(args.imageStorageId ? { imageStorageId: args.imageStorageId } : {}),
    });
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const session = await requireUser(ctx);
    const tool = await getOwnedTool(ctx, session, args.toolId);
    if (await hasActiveLoan(ctx, tool._id)) {
      throw new ConvexError(
        "This tool is out on loan. Mark it returned before deleting it.",
      );
    }
    await archiveTool(ctx, tool, session.user._id);
  },
});
