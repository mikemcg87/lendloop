import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Demo data for reviewers, so the app is not empty and the overdue workflow
// has something to act on without creating a second account:
//
//   npx convex run seed:demo '{"borrowerEmail":"you@example.com"}'
//
// Internal, so it can only be run from the CLI or dashboard, never by a
// client. Safe to run twice: it does nothing if the demo neighbour exists.
export const demo = internalMutation({
  args: { borrowerEmail: v.optional(v.string()) },
  handler: async (ctx, { borrowerEmail }) => {
    const tokenIdentifier = "demo|aoife";
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .unique();
    if (existing) return "Demo data already present.";

    const ownerId = await ctx.db.insert("users", {
      tokenIdentifier,
      clerkId: "demo_aoife",
      name: "Aoife (demo neighbour)",
      trustedLender: true,
    });
    const tool = (
      name: string,
      category: "Garden" | "Camping" | "Kitchen" | "Power Tools",
      condition: "Like new" | "Good" | "Fair",
      description: string,
      status: "available" | "on_loan" = "available",
    ) =>
      ctx.db.insert("tools", {
        ownerId,
        name,
        category,
        condition,
        description,
        status,
      });
    await tool("Hedge trimmer", "Garden", "Good", "Electric, 50cm blade. Extension lead included.");
    await tool("Two-ring camping stove", "Camping", "Like new", "Gas not included.");
    await tool("Stand mixer", "Kitchen", "Fair", "Works well, bowl has a small dent.");

    const borrower = borrowerEmail
      ? (await ctx.db.query("users").collect()).find(
          (user) => user.email === borrowerEmail,
        )
      : undefined;
    const sanderId = await tool(
      "Orbital sander",
      "Power Tools",
      "Good",
      "Takes 125mm discs. A few spare discs in the case.",
      borrower ? "on_loan" : "available",
    );
    if (!borrower) {
      return "Demo neighbour and 4 tools created. Pass borrowerEmail to also create an overdue loan.";
    }
    // A loan that was due back two days ago, for the overdue workflow.
    const now = Date.now();
    await ctx.db.insert("requests", {
      toolId: sanderId,
      ownerId,
      borrowerId: borrower._id,
      startDate: isoDate(now - 6 * DAY_MS),
      endDate: isoDate(now - 2 * DAY_MS),
      status: "accepted",
    });
    return `Demo neighbour, 4 tools and one overdue loan for ${borrower.name} created.`;
  },
});
