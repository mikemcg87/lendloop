"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

// Holds signed-in views back until the Convex user row exists (created by
// UserSync on sign-in), so their queries never run unprovisioned.
export function SignedInGate({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me);
  if (!me) return <p className="text-sm text-stone-500">Loading…</p>;
  return children;
}
