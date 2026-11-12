import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { sign } from "./lib/hmac";
import { createBackend } from "./test.setup";

type Event = "requested" | "accepted" | "rejected" | "cancelled" | "overdue" | "returned";

async function setup() {
  const backend = createBackend();
  const owner = await backend.addUser("owner");
  const borrower = await backend.addUser("borrower");
  const toolId = await backend.addTool(owner.userId);
  const requestId = await backend.addRequest(toolId, owner.userId, borrower.userId, {
    startDate: "2099-01-01",
    endDate: "2099-01-03",
  });
  return { ...backend, owner, borrower, toolId, requestId };
}

describe("notifications.payload", () => {
  it.each(["requested", "cancelled"] as const)(
    "sends %s events to the owner",
    async (event) => {
      const { t, requestId } = await setup();
      const data = await t.query(internal.notifications.payload, { requestId, event });
      expect(data?.recipient).toEqual({ name: "owner", email: "owner@example.com" });
      expect(data?.counterpartName).toBe("borrower");
    },
  );

  it.each(["accepted", "rejected", "returned", "overdue"] as const)(
    "sends %s events to the borrower",
    async (event) => {
      const { t, requestId } = await setup();
      const data = await t.query(internal.notifications.payload, { requestId, event });
      expect(data?.recipient).toEqual({ name: "borrower", email: "borrower@example.com" });
      expect(data?.counterpartName).toBe("owner");
    },
  );

  it.each(["requested", "accepted", "rejected", "cancelled", "overdue", "returned"] as const)(
    "carries only the minimal fields for %s and never the counterpart email",
    async (event) => {
      const { t, requestId } = await setup();
      const data = await t.query(internal.notifications.payload, { requestId, event });
      expect(Object.keys(data!).sort()).toEqual(
        [
          "counterpartName",
          "endDate",
          "event",
          "eventId",
          "recipient",
          "requestId",
          "startDate",
          "toolName",
        ].sort(),
      );
      const counterpartEmail = ["requested", "cancelled"].includes(event)
        ? "borrower@example.com"
        : "owner@example.com";
      expect(JSON.stringify(data)).not.toContain(counterpartEmail);
      expect(data).toMatchObject({
        event,
        requestId,
        toolName: "Cordless drill",
        startDate: "2099-01-01",
        endDate: "2099-01-03",
      });
    },
  );

  it("builds eventId as requestId:event", async () => {
    const { t, requestId } = await setup();
    const data = await t.query(internal.notifications.payload, {
      requestId,
      event: "accepted",
    });
    expect(data?.eventId).toBe(`${requestId}:accepted`);
  });
});

describe("notifications.dispatch", () => {
  const url = "https://n8n.test/webhook/notify";
  const secret = "test-secret";
  const saved = {
    url: process.env.N8N_NOTIFY_WEBHOOK_URL,
    secret: process.env.N8N_WEBHOOK_SECRET,
  };

  function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  beforeEach(() => {
    process.env.N8N_NOTIFY_WEBHOOK_URL = url;
    process.env.N8N_WEBHOOK_SECRET = secret;
  });

  afterEach(() => {
    restoreEnv("N8N_NOTIFY_WEBHOOK_URL", saved.url);
    restoreEnv("N8N_WEBHOOK_SECRET", saved.secret);
    vi.unstubAllGlobals();
  });

  async function dispatch(
    t: Awaited<ReturnType<typeof setup>>["t"],
    requestId: Awaited<ReturnType<typeof setup>>["requestId"],
    event: Event,
  ) {
    await t.action(internal.notifications.dispatch, { requestId, event, attempt: 0 });
  }

  it("posts a body signed with the shared secret", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { t, requestId } = await setup();
    await dispatch(t, requestId, "accepted");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(url);
    const body = init.body as string;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-LendLoop-Signature"]).toBe(await sign(secret, body));
    const parsed = JSON.parse(body);
    expect(parsed.sentAt).toBeTypeOf("number");
    expect(parsed.eventId).toBe(`${requestId}:accepted`);
  });

  it("does nothing when the webhook is not configured", async () => {
    delete process.env.N8N_NOTIFY_WEBHOOK_URL;
    delete process.env.N8N_WEBHOOK_SECRET;
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { t, requestId } = await setup();
    await dispatch(t, requestId, "accepted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up after five attempts and records one failure row", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { t, requestId } = await setup();
    await dispatch(t, requestId, "accepted");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("automationEvents")
        .withIndex("by_request", (q) => q.eq("requestId", requestId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "notification_failed",
      key: `${requestId}:accepted:failed`,
      status: "accepted",
    });
  });
});
