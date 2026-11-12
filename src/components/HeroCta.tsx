"use client";

import { SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated } from "convex/react";
import Link from "next/link";

const cta =
  "inline-block border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper hover:bg-ink-soft";

export function HeroCta() {
  return (
    <>
      <Unauthenticated>
        <SignInButton mode="modal" forceRedirectUrl="/dashboard">
          <button className={cta}>Sign in to lend or borrow</button>
        </SignInButton>
      </Unauthenticated>
      <Authenticated>
        <Link href="/dashboard" className={cta}>
          Open the board
        </Link>
      </Authenticated>
    </>
  );
}
