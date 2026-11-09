import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "./lib/hmac";
import { createBackend, dayOffset } from "./test.setup";

const SECRET = "test-webhook-secret";

async function signedInit(
  method: "GET" | "POST",
  pathname: string,
  options: {
    body?: unknown;
    rawBody?: string;
    secret?: string;
    timestamp?: number;
    signedBody?: string;
    signedPath?: string;
    signedMethod?: string;
  } = {},
): Promise<RequestInit> {
  const rawBody =
    options.rawBody ??
    (options.body === undefined ? "" : JSON.stringify(options.body));
  const timestamp = String(options.timestamp ?? Date.now());
  const message = `${timestamp}.${options.signedMethod ?? method}.${
    options.signedPath ?? pathname
  }.${options.signedBody ?? rawBody}`;
  return {
    method,
    headers: {
      "X-LendLoop-Timestamp": timestamp,
      "X-LendLoop-Signature": await sign(options.secret ?? SECRET, message),
    },
    ...(method === "POST" ? { body: rawBody } : {}),
  };
}

beforeEach(() => {
  vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signature checks", () => {
  const path = "/n8n/overdue-loans";

  it("returns 200 with an empty list for a valid signed GET", async () => {
    const { t } = createBackend();
    const response = await t.fetch(path, await signedInit("GET", path));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loans: [] });
  });

  it("returns 503 when the secret is not configured", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "");
    const { t } = createBackend();
    const response = await t.fetch(path, await signedInit("GET", path));
    expect(response.status).toBe(503);
  });

  it("returns 401 when both headers are missing", async () => {
    const { t } = createBackend();
    expect((await t.fetch(path, { method: "GET" })).status).toBe(401);
  });

  it("returns 401 when only the signature is missing", async () => {
    const { t } = createBackend();
    const response = await t.fetch(path, {
      method: "GET",
      headers: { "X-LendLoop-Timestamp": String(Date.now()) },
    });
    expect(response.status).toBe(401);
  });

  it("returns 401 when only the timestamp is missing", async () => {
    const { t } = createBackend();
    const init = await signedInit("GET", path);
    const headers = new Headers(init.headers);
    headers.delete("X-LendLoop-Timestamp");
    expect((await t.fetch(path, { ...init, headers })).status).toBe(401);
  });

  it("returns 401 for a signature made with the wrong secret", async () => {
    const { t } = createBackend();
    const response = await t.fetch(
      path,
      await signedInit("GET", path, { secret: "someone-elses-secret" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 for a malformed signature", async () => {
    const { t } = createBackend();
    const response = await t.fetch(path, {
      method: "GET",
      headers: {
        "X-LendLoop-Timestamp": String(Date.now()),
        "X-LendLoop-Signature": "zz",
      },
    });
    expect(response.status).toBe(401);
  });

  it("returns 401 for a stale timestamp with an otherwise valid signature", async () => {
    const { t } = createBackend();
    const stale = Date.now() - 6 * 60 * 1000;
    const response = await t.fetch(
      path,
      await signedInit("GET", path, { timestamp: stale }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 for a timestamp too far in the future", async () => {
    const { t } = createBackend();
    const future = Date.now() + 6 * 60 * 1000;
    const response = await t.fetch(
      path,
      await signedInit("GET", path, { timestamp: future }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 for a non-numeric timestamp", async () => {
    const { t } = createBackend();
    const response = await t.fetch(path, {
      method: "GET",
      headers: {
        "X-LendLoop-Timestamp": "yesterday",
        "X-LendLoop-Signature": await sign(SECRET, `yesterday.GET.${path}.`),
      },
    });
    expect(response.status).toBe(401);
  });

  it("returns 401 when the body was tampered with after signing", async () => {
    const { t } = createBackend();
    const claim = "/n8n/claim-reminder";
    const signed = { requestId: "abc", runDate: dayOffset(0) };
    const tampered = { requestId: "xyz", runDate: dayOffset(0) };
    const response = await t.fetch(
      claim,
      await signedInit("POST", claim, {
        rawBody: JSON.stringify(tampered),
        signedBody: JSON.stringify(signed),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 when a GET signature is replayed on a POST route", async () => {
    const { t } = createBackend();
    const claim = "/n8n/claim-reminder";
    const body = { requestId: "abc", runDate: dayOffset(0) };
    const response = await t.fetch(
      claim,
      await signedInit("POST", claim, {
        body,
        signedMethod: "GET",
        signedPath: path,
        signedBody: "",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 when a signature for one path is replayed on another", async () => {
    const { t } = createBackend();
    const claim = "/n8n/claim-reminder";
    const activity = "/n8n/activity";
    const body = { requestId: "abc", runDate: dayOffset(0) };
    const response = await t.fetch(
      activity,
      await signedInit("POST", activity, { body, signedPath: claim }),
    );
    expect(response.status).toBe(401);
  });
});

describe("signed POST routes", () => {
  const activity = "/n8n/activity";

  it("returns 400 from /n8n/activity for an unknown kind", async () => {
    const { t } = createBackend();
    const response = await t.fetch(
      activity,
      await signedInit("POST", activity, {
        body: { requestId: "abc", kind: "carrier_pigeon", key: "k" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 from /n8n/activity for an unknown status", async () => {
    const { t } = createBackend();
    const response = await t.fetch(
      activity,
      await signedInit("POST", activity, {
        body: { requestId: "abc", kind: "reminder_sent", key: "k", status: "lost" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 from /n8n/activity for an oversized key", async () => {
    const { t } = createBackend();
    const response = await t.fetch(
      activity,
      await signedInit("POST", activity, {
        body: { requestId: "abc", kind: "reminder_sent", key: "k".repeat(201) },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for a signed body that is not a JSON object", async () => {
    const { t } = createBackend();
    for (const rawBody of ["not json", "[]", "null"]) {
      const response = await t.fetch(
        activity,
        await signedInit("POST", activity, { rawBody }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("records an activity event for a valid signed request", async () => {
    const backend = createBackend();
    const owner = await backend.addUser("owner");
    const borrower = await backend.addUser("borrower");
    const toolId = await backend.addTool(owner.userId);
    const requestId = await backend.addRequest(toolId, owner.userId, borrower.userId);
    const body = { requestId, kind: "reminder_sent", key: "run-1" };

    const response = await backend.t.fetch(
      activity,
      await signedInit("POST", activity, { body }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "recorded" });
  });

  it("returns 400 from /n8n/claim-reminder for a run date far from today", async () => {
    const { t } = createBackend();
    const claim = "/n8n/claim-reminder";
    const response = await t.fetch(
      claim,
      await signedInit("POST", claim, {
        body: { requestId: "abc", runDate: dayOffset(-10) },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("claims a reminder through /n8n/claim-reminder", async () => {
    const backend = createBackend();
    const owner = await backend.addUser("owner");
    const borrower = await backend.addUser("borrower");
    const toolId = await backend.addTool(owner.userId, { status: "on_loan" });
    const requestId = await backend.addRequest(toolId, owner.userId, borrower.userId, {
      status: "accepted",
      endDate: dayOffset(-2),
    });
    const claim = "/n8n/claim-reminder";
    const body = { requestId, runDate: dayOffset(0) };

    const response = await backend.t.fetch(
      claim,
      await signedInit("POST", claim, { body }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: true, result: "marked_overdue" });
  });
});
