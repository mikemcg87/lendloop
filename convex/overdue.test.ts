import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { createBackend, dayOffset } from "./test.setup";

const today = dayOffset(0);
const yesterday = dayOffset(-1);
const tomorrow = dayOffset(1);

async function setup() {
  const backend = createBackend();
  const owner = await backend.addUser("owner");
  const borrower = await backend.addUser("borrower");
  const toolId = await backend.addTool(owner.userId, { status: "on_loan" });
  const loan = (overrides: Parameters<typeof backend.addRequest>[3]) =>
    backend.addRequest(toolId, owner.userId, borrower.userId, overrides);
  return { ...backend, owner, borrower, toolId, loan };
}

describe("overdue.listDue", () => {
  it("returns accepted loans past their end date and loans already overdue", async () => {
    const { t, loan } = await setup();
    const late = await loan({ status: "accepted", endDate: yesterday });
    const stillLate = await loan({ status: "overdue", endDate: dayOffset(-5) });
    const due = await t.query(internal.overdue.listDue, { today });
    expect(due.map((d) => d.requestId).sort()).toEqual([late, stillLate].sort());
  });

  it("excludes loans not yet due, due today, or no longer active", async () => {
    const { t, loan } = await setup();
    await loan({ status: "accepted", endDate: today });
    await loan({ status: "accepted", endDate: tomorrow });
    await loan({ status: "requested", endDate: yesterday });
    await loan({ status: "returned", endDate: yesterday });
    await loan({ status: "rejected", endDate: yesterday });
    await loan({ status: "cancelled", endDate: yesterday });
    expect(await t.query(internal.overdue.listDue, { today })).toEqual([]);
  });

  it("excludes loans already reminded today but not those reminded yesterday", async () => {
    const { t, loan } = await setup();
    await loan({ status: "overdue", endDate: dayOffset(-3), lastReminderDate: today });
    const pending = await loan({
      status: "overdue",
      endDate: dayOffset(-3),
      lastReminderDate: yesterday,
    });
    const due = await t.query(internal.overdue.listDue, { today });
    expect(due.map((d) => d.requestId)).toEqual([pending]);
  });

  it("returns only the fields the webhook needs", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "accepted", endDate: yesterday });
    const [entry] = await t.query(internal.overdue.listDue, { today });
    expect(Object.keys(entry).sort()).toEqual(
      ["borrower", "endDate", "ownerName", "requestId", "runDate", "toolName"].sort(),
    );
    expect(entry).toEqual({
      requestId,
      runDate: today,
      endDate: yesterday,
      toolName: "Cordless drill",
      ownerName: "owner",
      borrower: { name: "borrower", email: "borrower@example.com" },
    });
    expect(Object.keys(entry.borrower).sort()).toEqual(["email", "name"]);
  });
});

describe("overdue.claimReminder", () => {
  it("claims the first call and flips accepted to overdue", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "accepted", endDate: yesterday });
    const result = await t.mutation(internal.overdue.claimReminder, {
      requestId,
      runDate: today,
    });
    expect(result).toEqual({ claimed: true, result: "marked_overdue" });
    const doc = await t.run((ctx) => ctx.db.get(requestId));
    expect(doc).toMatchObject({ status: "overdue", lastReminderDate: today });
  });

  it("refuses a second claim for the same request and run date", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "accepted", endDate: yesterday });
    const args = { requestId, runDate: today };
    await t.mutation(internal.overdue.claimReminder, args);
    expect(await t.mutation(internal.overdue.claimReminder, args)).toEqual({
      claimed: false,
      result: "already_claimed",
    });
  });

  it("claims an already-overdue loan on a new run date", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({
      status: "overdue",
      endDate: dayOffset(-4),
      lastReminderDate: yesterday,
    });
    expect(
      await t.mutation(internal.overdue.claimReminder, { requestId, runDate: today }),
    ).toEqual({ claimed: true, result: "still_overdue" });
    const doc = await t.run((ctx) => ctx.db.get(requestId));
    expect(doc?.lastReminderDate).toBe(today);
  });

  it("does not claim a returned loan", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "returned", endDate: yesterday });
    expect(
      await t.mutation(internal.overdue.claimReminder, { requestId, runDate: today }),
    ).toEqual({ claimed: false, result: "not_overdue" });
    const doc = await t.run((ctx) => ctx.db.get(requestId));
    expect(doc?.status).toBe("returned");
    expect(doc?.lastReminderDate).toBeUndefined();
  });

  it("does not mark an accepted loan overdue before its end date has passed", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "accepted", endDate: today });
    expect(
      await t.mutation(internal.overdue.claimReminder, { requestId, runDate: today }),
    ).toEqual({ claimed: false, result: "not_overdue" });
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe("accepted");
  });

  it("reports not_found for an unknown or malformed id", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "accepted", endDate: yesterday });
    await t.run((ctx) => ctx.db.delete(requestId));
    for (const id of [requestId, "not-an-id"]) {
      expect(
        await t.mutation(internal.overdue.claimReminder, {
          requestId: id,
          runDate: today,
        }),
      ).toEqual({ claimed: false, result: "not_found" });
    }
  });

  it("does not accept an id from another table", async () => {
    const { t, toolId } = await setup();
    expect(
      await t.mutation(internal.overdue.claimReminder, {
        requestId: toolId,
        runDate: today,
      }),
    ).toEqual({ claimed: false, result: "not_found" });
  });
});

describe("automation.record", () => {
  it("is idempotent on key", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "accepted" });
    const args = { requestId, kind: "reminder_sent", key: `${requestId}:2026-01-01` } as const;
    expect(await t.mutation(internal.automation.record, args)).toBe("recorded");
    expect(await t.mutation(internal.automation.record, args)).toBe("already_recorded");
    const rows = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestId, kind: "reminder_sent", key: args.key });
  });

  it("keeps separate rows for separate keys", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "accepted" });
    await t.mutation(internal.automation.record, {
      requestId,
      kind: "notification_sent",
      key: "a",
      status: "accepted",
    });
    await t.mutation(internal.automation.record, {
      requestId,
      kind: "notification_sent",
      key: "b",
      status: "returned",
    });
    expect(await t.run((ctx) => ctx.db.query("automationEvents").collect())).toHaveLength(2);
  });

  it("rejects unknown request ids with not_found and writes nothing", async () => {
    const { t, loan } = await setup();
    const requestId = await loan({ status: "accepted" });
    await t.run((ctx) => ctx.db.delete(requestId));
    for (const id of [requestId, "garbage"]) {
      expect(
        await t.mutation(internal.automation.record, {
          requestId: id,
          kind: "reminder_sent",
          key: "k",
        }),
      ).toBe("not_found");
    }
    expect(await t.run((ctx) => ctx.db.query("automationEvents").collect())).toEqual([]);
  });
});
