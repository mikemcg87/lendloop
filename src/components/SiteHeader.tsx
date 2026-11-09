"use client";

import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { Wrench } from "lucide-react";
import Link from "next/link";

const navLink = "rounded-md px-3 py-2 font-medium hover:bg-stone-100";

function SignedInNav() {
  const me = useQuery(api.users.me);
  return (
    <>
      <Link href="/dashboard" className={navLink}>
        Dashboard
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
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Wrench className="size-5 text-emerald-700" aria-hidden />
          LendLoop
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-3">
          <Unauthenticated>
            <SignInButton mode="modal">
              <button className={navLink}>Sign in</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="rounded-md bg-emerald-700 px-3 py-2 font-medium text-white hover:bg-emerald-800">
                Sign up
              </button>
            </SignUpButton>
          </Unauthenticated>
          <Authenticated>
            <SignedInNav />
          </Authenticated>
        </nav>
      </div>
    </header>
  );
}
