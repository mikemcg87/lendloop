"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";

const navLink =
  "font-mono text-[13px] underline-offset-4 hover:underline";

function SignedInNav() {
  const me = useQuery(api.users.me);
  return (
    <>
      <Link href="/dashboard" className={navLink}>
        The board
      </Link>
      {/* Cosmetic only: every admin function re-checks the role server-side. */}
      {me?.role === "admin" && (
        <Link href="/admin" className={navLink}>
          Admin
        </Link>
      )}
      <UserButton />
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b-[3px] border-double border-ink">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
        <Link href="/" className="text-2xl font-medium tracking-tight">
          Lend<i className="font-normal">Loop</i>
        </Link>
        <nav className="flex items-center gap-5">
          <Unauthenticated>
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className={navLink}>Sign in</button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <SignedInNav />
          </Authenticated>
        </nav>
      </div>
    </header>
  );
}
