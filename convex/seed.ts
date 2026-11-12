import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Category, Condition } from "./lib/domain";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type SeedTool = {
  photo: string;
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

const AOIFE: SeedTool[] = [
  { photo: "hedge-trimmer", name: "Hedge trimmer", category: "Garden", condition: "Good", description: "Electric, 50cm blade. Extension lead included." },
  { photo: "camping-stove", name: "Two-ring camping stove", category: "Camping", condition: "Like new", description: "Gas not included." },
  { photo: "stand-mixer", name: "Stand mixer", category: "Kitchen", condition: "Fair", description: "Works well, bowl has a small dent." },
  { photo: "pineapple", name: "Pineapple", category: "Kitchen", condition: "Like new", description: "One pineapple. Not strictly a tool. Please bring it back uneaten." },
  { photo: "pasta-machine", name: "Pasta machine", category: "Kitchen", condition: "Like new", description: "Hand-cranked, clamps to a table. Makes sheets, tagliatelle and a mess." },
  { photo: "paint-roller", name: "Roller, tray and extension pole", category: "Painting", condition: "Good", description: "Pole reaches a normal ceiling. Sleeve is washed but not new." },
  { photo: "jump-leads", name: "Jump leads", category: "Automotive", condition: "Good", description: "Three metres, fine for a petrol car. Instructions are in the bag." },
];
const SANDER: SeedTool = { photo: "orbital-sander", name: "Orbital sander", category: "Power Tools", condition: "Good", description: "Takes 125mm discs. A few spare discs in the case." };
const DECLAN: SeedTool[] = [
  { photo: "cordless-drill", name: "Cordless drill", category: "Power Tools", condition: "Good", description: "Two batteries and the charger are in the case." },
  { photo: "pressure-washer", name: "Pressure washer", category: "Garden", condition: "Good", description: "Fits a standard garden tap. Patio head not included." },
  { photo: "tent", name: "Four-person tent", category: "Camping", condition: "Like new", description: "Used twice. All the pegs are there, I counted." },
  { photo: "wallpaper-steamer", name: "Wallpaper steamer", category: "Painting", condition: "Fair", description: "Takes ten minutes to heat up. Mind the hose, it gets hot." },
  { photo: "socket-set", name: "Socket set", category: "Automotive", condition: "Well used", description: "Metric, 8 to 24mm. The 10mm is missing, as is tradition." },
  { photo: "lawnmower", name: "Electric lawnmower", category: "Garden", condition: "Good", description: "Fine for a small lawn. Bring your own extension lead." },
  { photo: "spirit-level", name: "Spirit level", category: "Hand Tools", condition: "Good", description: "1.2 metres. Long enough for shelves and a door frame." },
  { photo: "wheelbarrow", name: "Wheelbarrow", category: "Garden", condition: "Well used", description: "Solid tyre, so no punctures. A bit rusty but sound." },
];
const LADDER: SeedTool = { photo: "extension-ladder", name: "Extension ladder", category: "Hand Tools", condition: "Good", description: "Reaches a first-floor gutter. Listed for you by the demo data." };

const BOARD = [...AOIFE, ...DECLAN];
const KIT = [SANDER, LADDER];

// Demo data for reviewers, so one account is enough to try everything: two
// neighbours with tools to borrow, a loan to you that is already overdue (for
// the n8n reminder workflow), and a request from a neighbour for a tool of
// yours (to approve or decline, then mark returned).
//
//   npx convex run seed:demo '{"borrowerEmail":"you@example.com","photosFrom":"http://localhost:3000"}'
//
// `photosFrom` is the running app's URL; the photos in public/demo are copied
// from there into Convex file storage. Leave it out for listings without
// photos. Internal, so it can only be run from the CLI or dashboard, never by
// a client. Safe to run twice, and it creates nothing until the borrower has
// signed in once.
export const demo = internalAction({
  args: { borrowerEmail: v.string(), photosFrom: v.optional(v.string()) },
  handler: async (ctx, { borrowerEmail, photosFrom }): Promise<string> => {
    const state = await ctx.runQuery(internal.seed.state, { borrowerEmail });
    if (state.seeded) return "Demo data already present.";
    if (!state.borrowerId) {
      return `No user with the email ${borrowerEmail} yet. Sign in to the app once, then run this again. Nothing was created.`;
    }
    await ctx.runMutation(internal.seed.board, {
      photos: await storePhotos(ctx, BOARD, photosFrom),
    });
    await ctx.runMutation(internal.seed.kit, {
      userId: state.borrowerId,
      photos: await storePhotos(ctx, KIT, photosFrom),
    });
    return `Two demo neighbours and ${BOARD.length + KIT.length} tools created, plus an overdue loan and an incoming request for ${borrowerEmail}.`;
  },
});

// The two functions below are for a public demo deployment only, and do
// nothing unless DEMO_MODE is set on it (DEMO_PHOTOS_FROM is the app's public
// URL). `resetDemo` runs daily from convex/crons.ts: it wipes every account,
// listing, loan and uploaded file and puts the neighbours' board back.
// `welcome` is scheduled by users.store for each new account, and gives it
// the same overdue loan and incoming request that `demo` gives one borrower.
export const resetDemo = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    if (!process.env.DEMO_MODE) return "Not a demo deployment. Nothing was changed.";
    await ctx.runMutation(internal.seed.wipe, {});
    await ctx.runMutation(internal.seed.board, {
      photos: await storePhotos(ctx, BOARD, process.env.DEMO_PHOTOS_FROM),
    });
    return "Demo data reset.";
  },
});

export const welcome = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (!process.env.DEMO_MODE) return;
    await ctx.runMutation(internal.seed.kit, {
      userId,
      photos: await storePhotos(ctx, KIT, process.env.DEMO_PHOTOS_FROM),
    });
  },
});

async function storePhotos(ctx: ActionCtx, tools: SeedTool[], photosFrom?: string) {
  const photos: Record<string, Id<"_storage">> = {};
  if (!photosFrom) return photos;
  const base = photosFrom.replace(/\/$/, "");
  for (const { photo } of tools) {
    const response = await fetch(`${base}/demo/${photo}.jpg`);
    if (!response.ok) {
      throw new Error(`Could not fetch ${photo}.jpg from ${base} (HTTP ${response.status}). Is the app running there?`);
    }
    photos[photo] = await ctx.storage.store(await response.blob());
  }
  return photos;
}

const neighbour = (ctx: QueryCtx, slug: string) =>
  ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", `demo|${slug}`))
    .unique();

const photosValidator = v.record(v.string(), v.id("_storage"));

function list(
  ctx: MutationCtx,
  photos: Record<string, Id<"_storage">>,
  ownerId: Id<"users">,
  tool: SeedTool,
  status: "available" | "on_loan" = "available",
) {
  return ctx.db.insert("tools", {
    ownerId,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    description: tool.description,
    imageStorageId: photos[tool.photo],
    status,
  });
}

export const state = internalQuery({
  args: { borrowerEmail: v.string() },
  handler: async (ctx, { borrowerEmail }) => {
    const users = await ctx.db.query("users").collect();
    return {
      seeded: (await neighbour(ctx, "aoife")) !== null,
      borrowerId: users.find((user) => user.email === borrowerEmail)?._id ?? null,
    };
  },
});

export const board = internalMutation({
  args: { photos: photosValidator },
  handler: async (ctx, { photos }) => {
    if (await neighbour(ctx, "aoife")) return;
    const add = (slug: string, name: string, trustedLender: boolean) =>
      ctx.db.insert("users", {
        tokenIdentifier: `demo|${slug}`,
        clerkId: `demo_${slug}`,
        name: `${name} (demo neighbour)`,
        trustedLender,
      });
    const aoife = await add("aoife", "Aoife", true);
    const declan = await add("declan", "Declan", false);
    for (const tool of DECLAN) await list(ctx, photos, declan, tool);
    for (const tool of AOIFE) await list(ctx, photos, aoife, tool);
  },
});

export const kit = internalMutation({
  args: { userId: v.id("users"), photos: photosValidator },
  handler: async (ctx, { userId, photos }) => {
    const aoife = await neighbour(ctx, "aoife");
    const declan = await neighbour(ctx, "declan");
    if (!aoife || !declan || !(await ctx.db.get(userId))) return;

    // A loan that was due back two days ago, for the overdue workflow.
    const now = Date.now();
    await ctx.db.insert("requests", {
      toolId: await list(ctx, photos, aoife._id, SANDER, "on_loan"),
      ownerId: aoife._id,
      borrowerId: userId,
      startDate: isoDate(now - 6 * DAY_MS),
      endDate: isoDate(now - 2 * DAY_MS),
      status: "accepted",
    });
    // A tool of yours that a neighbour has asked for, waiting on your answer.
    await ctx.db.insert("requests", {
      toolId: await list(ctx, photos, userId, LADDER),
      ownerId: userId,
      borrowerId: declan._id,
      startDate: isoDate(now + DAY_MS),
      endDate: isoDate(now + 3 * DAY_MS),
      status: "requested",
    });
  },
});

export const wipe = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of ["automationEvents", "requests", "tools", "adminAuditLog", "users"] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(row._id);
      }
    }
    for (const file of await ctx.db.system.query("_storage").collect()) {
      await ctx.storage.delete(file._id);
    }
  },
});
