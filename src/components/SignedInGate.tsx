"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { Note } from "./ui";

// Holds signed-in views back until the Convex user row exists (created by
// UserSync on sign-in), so their queries never run unprovisioned.
export function SignedInGate({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me);
  if (!me) return <Note>Opening the ledger…</Note>;
  return children;
}
