/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { JSONValue } from "convex/values";
import { afterEach, beforeEach, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.ts"]);

export type Harness = ReturnType<typeof createBackend>;

type Instance = ReturnType<typeof convexTest>;
const instances: Instance[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  while (instances.length) {
    await instances.pop()!.finishAllScheduledFunctions(vi.runAllTimers);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

export function createBackend() {
  const t = convexTest(schema, modules);
  instances.push(t);

  async function addUser(
    name: string,
    options: { role?: JSONValue; trustedLender?: boolean } = {},
  ) {
    const tokenIdentifier = `https://issuer.test|${name}`;
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier,
        clerkId: name,
        name,
        email: `${name}@example.com`,
        trustedLender: options.trustedLender ?? false,
      }),
    );
    const as = t.withIdentity({
      tokenIdentifier,
      subject: name,
      issuer: "https://issuer.test",
      name,
      ...(options.role === undefined ? {} : { role: options.role }),
    });
    return { userId, as };
  }

  async function addTool(
    ownerId: Id<"users">,
    overrides: { name?: string; status?: "available" | "on_loan" } = {},
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("tools", {
        ownerId,
        name: overrides.name ?? "Cordless drill",
        category: "Power Tools",
        condition: "Good",
        description: "Works well.",
        status: overrides.status ?? "available",
      }),
    );
  }

  async function addRequest(
    toolId: Id<"tools">,
    ownerId: Id<"users">,
    borrowerId: Id<"users">,
    overrides: {
      status?:
        | "requested"
        | "accepted"
        | "rejected"
        | "cancelled"
        | "overdue"
        | "returned";
      startDate?: string;
      endDate?: string;
      lastReminderDate?: string;
    } = {},
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("requests", {
        toolId,
        ownerId,
        borrowerId,
        startDate: overrides.startDate ?? dayOffset(0),
        endDate: overrides.endDate ?? dayOffset(3),
        status: overrides.status ?? "requested",
        lastReminderDate: overrides.lastReminderDate,
      }),
    );
  }

  return { t, addUser, addTool, addRequest };
}

export function dayOffset(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function errorMessage(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    return typeof data === "string" ? data : String(error);
  }
  return null;
}
