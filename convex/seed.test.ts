import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { createBackend } from "./test.setup";

const page = { numItems: 10, cursor: null };

async function setup() {
  const backend = createBackend();
  const { t } = backend;
  const counts = () =>
    t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).map((user) => user.name),
      tools: (await ctx.db.query("tools").collect()).map((tool) => tool.name),
      requests: (await ctx.db.query("requests").collect()).length,
      files: (await ctx.db.system.query("_storage").collect()).length,
    }));
  const signUp = async (name: string) => {
    const as = t.withIdentity({ tokenIdentifier: `https://issuer.test|${name}`, subject: name, name });
    const userId = await as.mutation(api.users.store, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return { as, userId };
  };
  return { ...backend, counts, signUp };
}

afterEach(() => vi.unstubAllEnvs());

describe("seed.demo", () => {
  it("creates nothing until the borrower has signed in, then seeds once", async () => {
    const { t, addUser, counts } = await setup();
    const args = { borrowerEmail: "borrower@example.com" };
    expect(await t.action(internal.seed.demo, args)).toContain("Nothing was created.");
    expect((await counts()).users).toEqual([]);

    await addUser("borrower");
    await t.action(internal.seed.demo, args);
    expect(await t.action(internal.seed.demo, args)).toBe("Demo data already present.");
    const after = await counts();
    expect(after.tools).toHaveLength(17);
    expect(after.requests).toBe(2);
  });
});

describe("demo deployment", () => {
  it("is off by default: no reset, no starter kit, admins see emails", async () => {
    const { t, addUser, addTool, counts, signUp } = await setup();
    const admin = await addUser("admin", { role: "admin" });
    await addTool(admin.userId);
    await signUp("newcomer");
    const before = await counts();

    expect(await t.action(internal.seed.resetDemo, {})).toBe(
      "Not a demo deployment. Nothing was changed.",
    );
    expect(await counts()).toEqual(before);
    expect(before.requests).toBe(0);
    const members = await admin.as.query(api.admin.listUsers, { paginationOpts: page });
    expect(members.page.map((user) => user.email)).toContain("admin@example.com");
  });

  it("reset wipes accounts, listings, loans and files and restores the board", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const { t, addUser, addTool, addRequest, counts } = await setup();
    const owner = await addUser("owner");
    const borrower = await addUser("borrower");
    await addRequest(await addTool(owner.userId, { name: "Left behind" }), owner.userId, borrower.userId);
    await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));

    await t.action(internal.seed.resetDemo, {});
    expect(await counts()).toEqual({
      users: ["Aoife (demo neighbour)", "Declan (demo neighbour)"],
      tools: expect.not.arrayContaining(["Left behind"]),
      requests: 0,
      files: 0,
    });
    expect((await counts()).tools).toHaveLength(15);
  });

  it("gives each new account its own overdue loan and incoming request, once", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const { t, counts, signUp } = await setup();
    await t.action(internal.seed.resetDemo, {});

    const { as, userId } = await signUp("newcomer");
    await signUp("newcomer");
    expect((await counts()).requests).toBe(2);
    const mine = await t.run((ctx) => ctx.db.query("requests").collect());
    expect(mine.map((r) => [r.status, r.borrowerId === userId, r.ownerId === userId])).toEqual([
      ["accepted", true, false],
      ["requested", false, true],
    ]);
    expect((await as.query(api.tools.listMine, {})).map((tool) => tool.name)).toEqual([
      "Extension ladder",
    ]);
  });

  it("hides member emails from the shared admin login", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const { addUser } = await setup();
    const admin = await addUser("admin", { role: "admin" });
    const members = await admin.as.query(api.admin.listUsers, { paginationOpts: page });
    expect(members.page).toHaveLength(1);
    expect(members.page[0].email).toBeUndefined();
  });
});
