import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { createBackend, dayOffset, errorMessage } from "./test.setup";

const page = { numItems: 10, cursor: null };

async function setup() {
  const backend = createBackend();
  const owner = await backend.addUser("owner");
  const borrower = await backend.addUser("borrower");
  const stranger = await backend.addUser("stranger");
  const admin = await backend.addUser("admin", { role: "admin" });
  const toolId = await backend.addTool(owner.userId);
  return { ...backend, owner, borrower, stranger, admin, toolId };
}

describe("unauthenticated callers", () => {
  it("are rejected by every signed-in function", async () => {
    const { t, toolId, owner, borrower } = await setup();
    const requestId = await t.run((ctx) =>
      ctx.db.insert("requests", {
        toolId,
        ownerId: owner.userId,
        borrowerId: borrower.userId,
        startDate: dayOffset(0),
        endDate: dayOffset(1),
        status: "requested",
      }),
    );
    const tool = {
      name: "Saw",
      category: "Hand Tools",
      condition: "Good",
      description: "",
    } as const;

    const calls: Array<[string, () => Promise<unknown>]> = [
      ["tools.browse", () => t.query(api.tools.browse, {})],
      ["tools.listMine", () => t.query(api.tools.listMine, {})],
      ["tools.create", () => t.mutation(api.tools.create, tool)],
      ["tools.update", () => t.mutation(api.tools.update, { toolId, ...tool })],
      ["tools.remove", () => t.mutation(api.tools.remove, { toolId })],
      ["tools.generateUploadUrl", () => t.mutation(api.tools.generateUploadUrl, {})],
      [
        "requests.create",
        () =>
          t.mutation(api.requests.create, {
            toolId,
            startDate: dayOffset(0),
            endDate: dayOffset(1),
          }),
      ],
      ["requests.listMine", () => t.query(api.requests.listMine, {})],
      ["requests.listIncoming", () => t.query(api.requests.listIncoming, {})],
      [
        "requests.respond",
        () => t.mutation(api.requests.respond, { requestId, decision: "accepted" }),
      ],
      ["requests.markReturned", () => t.mutation(api.requests.markReturned, { requestId })],
      ["requests.cancel", () => t.mutation(api.requests.cancel, { requestId })],
      ["admin.listLoans", () => t.query(api.admin.listLoans, { paginationOpts: page })],
      ["admin.listUsers", () => t.query(api.admin.listUsers, { paginationOpts: page })],
      ["admin.removeListing", () => t.mutation(api.admin.removeListing, { toolId })],
      [
        "admin.setTrustedLender",
        () =>
          t.mutation(api.admin.setTrustedLender, {
            userId: owner.userId,
            trusted: true,
          }),
      ],
    ];

    for (const [name, call] of calls) {
      expect(await errorMessage(call()), name).toBe("Sign in required.");
    }
  });

  it("can still read the public listing", async () => {
    const { t } = await setup();
    await expect(t.query(api.tools.listPublic, {})).resolves.toBeDefined();
  });

  it("are rejected by users.store", async () => {
    const { t } = await setup();
    expect(await errorMessage(t.mutation(api.users.store, {}))).toBe(
      "Sign in required.",
    );
  });
});

describe("tools.listPublic", () => {
  it("exposes only _id, name and category", async () => {
    const { t, toolId } = await setup();
    const tools = await t.query(api.tools.listPublic, {});
    expect(tools).toEqual([
      { _id: toolId, name: "Cordless drill", category: "Power Tools" },
    ]);
    expect(Object.keys(tools[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  it("hides tools that are on loan", async () => {
    const { t, owner, addTool } = await setup();
    await addTool(owner.userId, { name: "Hedge trimmer", status: "on_loan" });
    const names = (await t.query(api.tools.listPublic, {})).map((x) => x.name);
    expect(names).toEqual(["Cordless drill"]);
  });

  it("hides deleted tools", async () => {
    const { t, owner, toolId } = await setup();
    await owner.as.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });
});

describe("tool ownership", () => {
  const edit = {
    name: "Hijacked",
    category: "Other",
    condition: "Fair",
    description: "",
  } as const;

  it("stops another user updating a tool", async () => {
    const { t, stranger, toolId } = await setup();
    expect(
      await errorMessage(stranger.as.mutation(api.tools.update, { toolId, ...edit })),
    ).toBe("You can only do this to your own items.");
    const tool = await t.run((ctx) => ctx.db.get(toolId));
    expect(tool?.name).toBe("Cordless drill");
  });

  it("stops another user deleting a tool", async () => {
    const { t, stranger, toolId } = await setup();
    expect(
      await errorMessage(stranger.as.mutation(api.tools.remove, { toolId })),
    ).toBe("You can only do this to your own items.");
    const tool = await t.run((ctx) => ctx.db.get(toolId));
    expect(tool?.deletedAt).toBeUndefined();
  });

  it("does not let an admin use the owner-only update", async () => {
    const { admin, toolId } = await setup();
    expect(
      await errorMessage(admin.as.mutation(api.tools.update, { toolId, ...edit })),
    ).toBe("You can only do this to your own items.");
  });
});

describe("request ownership", () => {
  async function withPendingRequest() {
    const ctx = await setup();
    const requestId = await ctx.addRequest(
      ctx.toolId,
      ctx.owner.userId,
      ctx.borrower.userId,
    );
    return { ...ctx, requestId };
  }

  it("lets only the tool owner respond", async () => {
    const { borrower, stranger, requestId } = await withPendingRequest();
    for (const who of [borrower, stranger]) {
      expect(
        await errorMessage(
          who.as.mutation(api.requests.respond, { requestId, decision: "accepted" }),
        ),
      ).toBe("You can only do this to your own items.");
    }
  });

  it("lets only the tool owner mark a loan returned", async () => {
    const { t, addRequest, toolId, owner, borrower, stranger } = await setup();
    const requestId = await addRequest(toolId, owner.userId, borrower.userId, {
      status: "accepted",
    });
    for (const who of [borrower, stranger]) {
      expect(
        await errorMessage(who.as.mutation(api.requests.markReturned, { requestId })),
      ).toBe("You can only do this to your own items.");
    }
    const request = await t.run((ctx) => ctx.db.get(requestId));
    expect(request?.status).toBe("accepted");
  });

  it("lets only the borrower cancel", async () => {
    const { owner, stranger, requestId } = await withPendingRequest();
    for (const who of [owner, stranger]) {
      expect(
        await errorMessage(who.as.mutation(api.requests.cancel, { requestId })),
      ).toBe("You can only cancel your own requests.");
    }
  });

  it("stops a user requesting their own tool", async () => {
    const { owner, toolId } = await setup();
    expect(
      await errorMessage(
        owner.as.mutation(api.requests.create, {
          toolId,
          startDate: dayOffset(0),
          endDate: dayOffset(1),
        }),
      ),
    ).toBe("You cannot borrow your own tool.");
  });
});

describe("admin access", () => {
  it("rejects a non-admin from every admin function", async () => {
    const { stranger, toolId, owner } = await setup();
    const denied = "Admin access required.";
    expect(
      await errorMessage(stranger.as.query(api.admin.listLoans, { paginationOpts: page })),
    ).toBe(denied);
    expect(
      await errorMessage(stranger.as.query(api.admin.listUsers, { paginationOpts: page })),
    ).toBe(denied);
    expect(
      await errorMessage(stranger.as.mutation(api.admin.removeListing, { toolId })),
    ).toBe(denied);
    expect(
      await errorMessage(
        stranger.as.mutation(api.admin.setTrustedLender, {
          userId: owner.userId,
          trusted: true,
        }),
      ),
    ).toBe(denied);
  });

  it.each([
    ["Admin"],
    ["ADMIN"],
    ["admin "],
    ["superuser"],
    [undefined],
    [null],
    [true],
    [["admin"]],
  ])("does not treat a role claim of %j as admin", async (role) => {
    const { addUser, toolId } = await setup();
    const imposter = await addUser("imposter", { role });
    expect(
      await errorMessage(imposter.as.mutation(api.admin.removeListing, { toolId })),
    ).toBe("Admin access required.");
    expect((await imposter.as.query(api.users.me, {}))?.role).toBe("user");
  });

  it("treats exactly role: admin as admin", async () => {
    const { admin } = await setup();
    expect((await admin.as.query(api.users.me, {}))?.role).toBe("admin");
  });

  it("lets an admin remove another user's listing and writes an audit row", async () => {
    const { t, admin, toolId } = await setup();
    await admin.as.mutation(api.admin.removeListing, { toolId });

    const tool = await t.run((ctx) => ctx.db.get(toolId));
    expect(tool?.deletedAt).toBeTypeOf("number");
    expect(tool?.deletedBy).toBe(admin.userId);

    const log = await t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorId: admin.userId,
      action: "remove_listing",
      targetId: toolId,
    });
  });

  it("lets an admin grant and revoke trusted lender, auditing each change", async () => {
    const { t, admin, owner } = await setup();
    await admin.as.mutation(api.admin.setTrustedLender, {
      userId: owner.userId,
      trusted: true,
    });
    expect((await t.run((ctx) => ctx.db.get(owner.userId)))?.trustedLender).toBe(true);

    await admin.as.mutation(api.admin.setTrustedLender, {
      userId: owner.userId,
      trusted: false,
    });
    expect((await t.run((ctx) => ctx.db.get(owner.userId)))?.trustedLender).toBe(false);

    const log = await t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log.map((row) => row.action)).toEqual([
      "grant_trusted_lender",
      "revoke_trusted_lender",
    ]);
    expect(log.every((row) => row.actorId === admin.userId)).toBe(true);
    expect(log.every((row) => row.targetId === owner.userId)).toBe(true);
  });

  it("does not write an audit row when trustedLender is unchanged", async () => {
    const { t, admin, owner } = await setup();
    await admin.as.mutation(api.admin.setTrustedLender, {
      userId: owner.userId,
      trusted: false,
    });
    expect(await t.run((ctx) => ctx.db.query("adminAuditLog").collect())).toEqual([]);
  });

  it("does not expose identity fields through admin.listUsers", async () => {
    const { admin } = await setup();
    const result = await admin.as.query(api.admin.listUsers, { paginationOpts: page });
    expect(result.page.length).toBeGreaterThan(0);
    for (const user of result.page) {
      expect(user).not.toHaveProperty("tokenIdentifier");
      expect(user).not.toHaveProperty("clerkId");
    }
  });
});

describe("users.store", () => {
  const identity = {
    tokenIdentifier: "https://issuer.test|newcomer",
    subject: "newcomer",
    name: "Newcomer",
  };

  it("creates a non-trusted user from the token alone", async () => {
    const { t } = await setup();
    const id = await t.withIdentity(identity).mutation(api.users.store, {});
    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user).toMatchObject({
      tokenIdentifier: identity.tokenIdentifier,
      clerkId: "newcomer",
      name: "Newcomer",
      trustedLender: false,
    });
  });

  it("takes no arguments, so trustedLender cannot be supplied", async () => {
    const { t } = await setup();
    const store = t.withIdentity(identity).mutation as unknown as (
      fn: typeof api.users.store,
      args: unknown,
    ) => Promise<unknown>;
    expect(
      await errorMessage(store(api.users.store, { trustedLender: true })),
    ).not.toBeNull();
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.find((u) => u.clerkId === "newcomer")).toBeUndefined();
  });

  it("does not duplicate the row when called twice", async () => {
    const { t } = await setup();
    const as = t.withIdentity(identity);
    const first = await as.mutation(api.users.store, {});
    const second = await as.mutation(api.users.store, {});
    expect(second).toBe(first);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("does not reset trustedLender when an existing user signs in again", async () => {
    const { t, admin } = await setup();
    const as = t.withIdentity(identity);
    const id = await as.mutation(api.users.store, {});
    await admin.as.mutation(api.admin.setTrustedLender, { userId: id, trusted: true });
    await as.mutation(api.users.store, {});
    expect((await t.run((ctx) => ctx.db.get(id)))?.trustedLender).toBe(true);
  });
});

describe("admin listings and loan filters", () => {
  it("lists every live listing to admins only", async () => {
    const { owner, admin, stranger, toolId, t } = await setup();
    await t.run((ctx) => ctx.db.patch(toolId, { starterFor: owner.userId }));
    const listings = await admin.as.query(api.admin.listListings, { paginationOpts: page });
    expect(listings.page.map((tool) => tool._id)).toEqual([toolId]);
    expect(
      await errorMessage(stranger.as.query(api.admin.listListings, { paginationOpts: page })),
    ).toBe("Admin access required.");
  });

  it("treats an accepted loan past its due date as overdue, not on loan", async () => {
    const { owner, borrower, admin, toolId, addRequest } = await setup();
    const late = await addRequest(toolId, owner.userId, borrower.userId, {
      status: "accepted",
      startDate: dayOffset(-5),
      endDate: dayOffset(-2),
    });
    const marked = await addRequest(toolId, owner.userId, borrower.userId, {
      status: "overdue",
      startDate: dayOffset(-9),
      endDate: dayOffset(-6),
    });
    const current = await addRequest(toolId, owner.userId, borrower.userId, {
      status: "accepted",
      endDate: dayOffset(2),
    });
    const ids = async (status: "overdue" | "accepted") =>
      (
        await admin.as.query(api.admin.listLoans, { paginationOpts: page, status })
      ).page.map((loan) => loan._id);
    expect((await ids("overdue")).sort()).toEqual([late, marked].sort());
    expect(await ids("accepted")).toEqual([current]);
  });
});

describe("board filters", () => {
  it("filters the signed-in board by availability", async () => {
    const { owner, stranger, addTool } = await setup();
    await addTool(owner.userId, { name: "Out", status: "on_loan" });
    const names = async (availability?: "available" | "on_loan") =>
      (await stranger.as.query(api.tools.browse, { availability })).map((tool) => tool.name);
    expect(await names("on_loan")).toEqual(["Out"]);
    expect(await names("available")).toEqual(["Cordless drill"]);
    expect(await names()).toHaveLength(2);
  });

  it("refuses a request for another account's starter tool", async () => {
    const { owner, borrower, toolId, t } = await setup();
    await t.run((ctx) => ctx.db.patch(toolId, { starterFor: owner.userId }));
    expect(
      await errorMessage(
        borrower.as.mutation(api.requests.create, {
          toolId,
          startDate: dayOffset(1),
          endDate: dayOffset(2),
        }),
      ),
    ).toBe("Listing not found.");
  });
});

describe("email privacy", () => {
  it("keeps email addresses out of ordinary and admin loan views", async () => {
    const { owner, borrower, stranger, admin, toolId, addRequest } = await setup();
    await addRequest(toolId, owner.userId, borrower.userId, { status: "accepted" });
    const mine = await borrower.as.query(api.requests.listMine, {});
    const incoming = await owner.as.query(api.requests.listIncoming, {});
    const browsed = await stranger.as.query(api.tools.browse, {});
    const loans = await admin.as.query(api.admin.listLoans, { paginationOpts: page });
    expect([mine.length, incoming.length, browsed.length, loans.page.length]).toEqual([
      1, 1, 1, 1,
    ]);
    for (const result of [mine, incoming, browsed, loans]) {
      expect(JSON.stringify(result)).not.toContain("@example.com");
    }
  });
});

describe("tools.create photo validation", () => {
  const fields = {
    name: "Saw",
    category: "Hand Tools",
    condition: "Good",
    description: "",
  } as const;

  it("rejects a stored file that is not an image", async () => {
    const { t, owner } = await setup();
    const imageStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "text/plain" })),
    );
    expect(
      await errorMessage(owner.as.mutation(api.tools.create, { ...fields, imageStorageId })),
    ).toBe("The photo must be an image file.");
  });

  it("rejects a photo that is already on someone else's listing", async () => {
    const { t, owner, stranger } = await setup();
    const imageStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "image/png" })),
    );
    await owner.as.mutation(api.tools.create, { ...fields, imageStorageId });
    expect(
      await errorMessage(stranger.as.mutation(api.tools.create, { ...fields, imageStorageId })),
    ).toBe("Photo upload not found.");
    // The owner can reuse their own photo on another listing.
    await owner.as.mutation(api.tools.create, { ...fields, name: "Second saw", imageStorageId });
  });

  it("accepts a stored image", async () => {
    const { t, owner } = await setup();
    const imageStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "image/png" })),
    );
    const toolId = await owner.as.mutation(api.tools.create, { ...fields, imageStorageId });
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.imageStorageId).toBe(imageStorageId);
  });
});
