"use client";

import { SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated } from "convex/react";
import Link from "next/link";

const cta =
  "inline-block rounded-md bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-800";

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
          Go to your dashboard
        </Link>
      </Authenticated>
    </>
  );
}
