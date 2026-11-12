import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { createBackend, dayOffset, errorMessage } from "./test.setup";

async function setup() {
  const backend = createBackend();
  const owner = await backend.addUser("owner");
  const borrower = await backend.addUser("borrower");
  const other = await backend.addUser("other");
  const admin = await backend.addUser("admin", { role: "admin" });
  const toolId = await backend.addTool(owner.userId);
  const request = (who: typeof borrower, startDate = dayOffset(1), endDate = dayOffset(3)) =>
    who.as.mutation(api.requests.create, { toolId, startDate, endDate });
  return { ...backend, owner, borrower, other, admin, toolId, request };
}

async function accepted() {
  const ctx = await setup();
  const requestId = await ctx.request(ctx.borrower);
  await ctx.owner.as.mutation(api.requests.respond, {
    requestId,
    decision: "accepted",
  });
  return { ...ctx, requestId };
}

describe("loan state machine", () => {
  it("creates a request in the requested state without touching the tool", async () => {
    const { t, request, borrower, toolId } = await setup();
    const requestId = await request(borrower);
    const doc = await t.run((ctx) => ctx.db.get(requestId));
    expect(doc?.status).toBe("requested");
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("available");
  });

  it("puts the tool on loan when the owner accepts", async () => {
    const { t, requestId, toolId } = await accepted();
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("accepted");
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("on_loan");
  });

  it("leaves the tool available when the owner rejects", async () => {
    const { t, owner, request, borrower, toolId } = await setup();
    const requestId = await request(borrower);
    await owner.as.mutation(api.requests.respond, { requestId, decision: "rejected" });
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("rejected");
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("available");
  });

  it("frees the tool and stamps returnedAt when marked returned", async () => {
    const { t, owner, requestId, toolId } = await accepted();
    await owner.as.mutation(api.requests.markReturned, { requestId });
    const doc = await t.run((ctx) => ctx.db.get(requestId));
    expect(doc?.status).toBe("returned");
    expect(doc?.returnedAt).toBeTypeOf("number");
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("available");
  });

  it("keeps the owner's damage note and shows it to both parties", async () => {
    const { owner, borrower, requestId } = await accepted();
    await owner.as.mutation(api.requests.markReturned, {
      requestId,
      note: "  One rubber foot is missing.  ",
    });
    const mine = await borrower.as.query(api.requests.listMine, {});
    const incoming = await owner.as.query(api.requests.listIncoming, {});
    expect(mine[0].returnNote).toBe("One rubber foot is missing.");
    expect(incoming[0].returnNote).toBe("One rubber foot is missing.");
  });

  it("stores no note when it is blank, and rejects one that is too long", async () => {
    const { t, owner, requestId } = await accepted();
    expect(
      await errorMessage(
        owner.as.mutation(api.requests.markReturned, {
          requestId,
          note: "x".repeat(301),
        }),
      ),
    ).toBe("The note must be 300 characters or fewer.");
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("accepted");
    await owner.as.mutation(api.requests.markReturned, { requestId, note: "   " });
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.returnNote).toBeUndefined();
  });

  it("can mark an overdue loan returned", async () => {
    const { t, owner, addRequest, toolId, borrower } = await setup();
    await t.run((ctx) => ctx.db.patch(toolId, { status: "on_loan" }));
    const requestId = await addRequest(toolId, owner.userId, borrower.userId, {
      status: "overdue",
    });
    await owner.as.mutation(api.requests.markReturned, { requestId });
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("returned");
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.status).toBe("available");
  });

  it("refuses to accept a second request while the tool has an active loan", async () => {
    const { owner, other, request } = await accepted();
    const second = await request(other);
    expect(
      await errorMessage(
        owner.as.mutation(api.requests.respond, {
          requestId: second,
          decision: "accepted",
        }),
      ),
    ).toBe("This tool is already out on loan. Mark it returned first.");
  });

  it("still lets the owner reject a request while the tool is on loan", async () => {
    const { t, owner, other, request } = await accepted();
    const second = await request(other);
    await owner.as.mutation(api.requests.respond, {
      requestId: second,
      decision: "rejected",
    });
    expect((await t.run((ctx) => ctx.db.get(second)))?.status).toBe("rejected");
  });

  it("refuses to respond to the same request twice", async () => {
    const { owner, requestId } = await accepted();
    for (const decision of ["accepted", "rejected"] as const) {
      expect(
        await errorMessage(
          owner.as.mutation(api.requests.respond, { requestId, decision }),
        ),
      ).toBe("This request has already been handled.");
    }
  });

  it("refuses to mark a non-active request returned", async () => {
    const { owner, request, borrower } = await setup();
    const requestId = await request(borrower);
    expect(
      await errorMessage(owner.as.mutation(api.requests.markReturned, { requestId })),
    ).toBe("Only an active loan can be marked returned.");
  });

  it("refuses to mark a returned loan returned again", async () => {
    const { owner, requestId } = await accepted();
    await owner.as.mutation(api.requests.markReturned, { requestId });
    expect(
      await errorMessage(owner.as.mutation(api.requests.markReturned, { requestId })),
    ).toBe("Only an active loan can be marked returned.");
  });

  it("lets the borrower cancel a pending request", async () => {
    const { t, borrower, request } = await setup();
    const requestId = await request(borrower);
    await borrower.as.mutation(api.requests.cancel, { requestId });
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("cancelled");
  });

  it("refuses to cancel after acceptance", async () => {
    const { t, borrower, requestId } = await accepted();
    expect(
      await errorMessage(borrower.as.mutation(api.requests.cancel, { requestId })),
    ).toBe("Only a pending request can be cancelled.");
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("accepted");
  });

  it("schedules a notification on each status change", async () => {
    const { t, owner, request, borrower } = await setup();
    const requestId = await request(borrower);
    await owner.as.mutation(api.requests.respond, { requestId, decision: "accepted" });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const events = scheduled.map(
      (job) => (job.args[0] as { event: string }).event,
    );
    expect(events.sort()).toEqual(["accepted", "requested"]);
  });
});

describe("request date validation", () => {
  it("rejects an end date before the start date", async () => {
    const { request, borrower } = await setup();
    expect(
      await errorMessage(request(borrower, dayOffset(5), dayOffset(2))),
    ).toBe("The end date must be on or after the start date.");
  });

  it("accepts a single-day loan", async () => {
    const { request, borrower } = await setup();
    await expect(request(borrower, dayOffset(2), dayOffset(2))).resolves.toBeDefined();
  });

  it.each([
    ["not-a-date"],
    ["2026/01/05"],
    ["2026-1-5"],
    ["2026-13-45"],
    ["2026-02-30T00:00"],
    [""],
  ])("rejects the malformed date %j", async (bad) => {
    const { request, borrower } = await setup();
    expect(await errorMessage(request(borrower, bad, dayOffset(3)))).toBe(
      "Dates must be valid YYYY-MM-DD values.",
    );
    expect(await errorMessage(request(borrower, dayOffset(1), bad))).toBe(
      "Dates must be valid YYYY-MM-DD values.",
    );
  });

  it.each([["2099-02-31"], ["2099-13-01"]])(
    "rejects the impossible calendar date %s",
    async (bad) => {
      const { request, borrower } = await setup();
      const message = "Dates must be valid YYYY-MM-DD values.";
      expect(await errorMessage(request(borrower, bad, "2099-12-31"))).toBe(message);
      expect(await errorMessage(request(borrower, dayOffset(1), bad))).toBe(message);
    },
  );

  it("accepts a real leap day", async () => {
    const { request, borrower } = await setup();
    await expect(request(borrower, "2096-02-29", "2096-02-29")).resolves.toBeDefined();
  });

  it("rejects a start date well in the past", async () => {
    const { request, borrower } = await setup();
    expect(
      await errorMessage(request(borrower, dayOffset(-30), dayOffset(3))),
    ).toBe("The start date cannot be in the past.");
  });

  it("allows starting today", async () => {
    const { request, borrower } = await setup();
    await expect(request(borrower, dayOffset(0), dayOffset(1))).resolves.toBeDefined();
  });
});

describe("request creation rules", () => {
  it("rejects a duplicate pending request by the same borrower", async () => {
    const { request, borrower } = await setup();
    await request(borrower);
    expect(await errorMessage(request(borrower))).toBe(
      "You already have a pending request for this tool.",
    );
  });

  it("lets a different borrower request the same tool", async () => {
    const { request, borrower, other } = await setup();
    await request(borrower);
    await expect(request(other)).resolves.toBeDefined();
  });

  it("lets a borrower request again after cancelling", async () => {
    const { request, borrower } = await setup();
    const first = await request(borrower);
    await borrower.as.mutation(api.requests.cancel, { requestId: first });
    await expect(request(borrower)).resolves.toBeDefined();
  });

  it("rejects a request for a deleted tool", async () => {
    const { owner, toolId, request, borrower } = await setup();
    await owner.as.mutation(api.tools.remove, { toolId });
    expect(await errorMessage(request(borrower))).toBe("Listing not found.");
  });
});

describe("deleting tools", () => {
  it("stops the owner deleting a tool that is on loan", async () => {
    const { t, owner, toolId } = await accepted();
    expect(await errorMessage(owner.as.mutation(api.tools.remove, { toolId }))).toBe(
      "This tool is out on loan. Mark it returned before deleting it.",
    );
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.deletedAt).toBeUndefined();
  });

  it("stops the owner deleting a tool whose loan is overdue", async () => {
    const { t, owner, toolId, borrower, addRequest } = await setup();
    await addRequest(toolId, owner.userId, borrower.userId, { status: "overdue" });
    expect(await errorMessage(owner.as.mutation(api.tools.remove, { toolId }))).toBe(
      "This tool is out on loan. Mark it returned before deleting it.",
    );
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.deletedAt).toBeUndefined();
  });

  it("auto-rejects pending requests when the owner deletes the tool", async () => {
    const { t, owner, toolId, request, borrower, other } = await setup();
    const first = await request(borrower);
    const second = await request(other);
    await owner.as.mutation(api.tools.remove, { toolId });
    for (const id of [first, second]) {
      expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("rejected");
    }
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.deletedAt).toBeTypeOf("number");
  });

  it("keeps a deleted tool readable on its loan history", async () => {
    const { owner, toolId, request, borrower } = await setup();
    await request(borrower);
    await owner.as.mutation(api.tools.remove, { toolId });
    const [entry] = await borrower.as.query(api.requests.listMine, {});
    expect(entry.tool).toMatchObject({ name: "Cordless drill", removed: true });
  });

  it("lets an admin remove a tool that is on loan", async () => {
    const { t, admin, toolId } = await accepted();
    await admin.as.mutation(api.admin.removeListing, { toolId });
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.deletedAt).toBeTypeOf("number");
  });

  it("still lets the owner mark an admin-removed loan returned", async () => {
    const { t, admin, owner, toolId, requestId } = await accepted();
    await admin.as.mutation(api.admin.removeListing, { toolId });
    await owner.as.mutation(api.requests.markReturned, { requestId });
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("returned");
  });

  it("does not let an admin remove the same listing twice", async () => {
    const { admin, toolId } = await setup();
    await admin.as.mutation(api.admin.removeListing, { toolId });
    expect(
      await errorMessage(admin.as.mutation(api.admin.removeListing, { toolId })),
    ).toBe("Listing not found.");
  });
});
