import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";
import { SignedInGate } from "@/components/SignedInGate";
import { SiteHeader } from "@/components/SiteHeader";

// The auth check reads the session cookie, so these routes block on the
// server instead of prerendering a static shell.
export const instant = false;

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Redirects signed-out visitors to sign-in. Data access is enforced
  // separately inside every Convex function.
  await auth.protect();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        <SignedInGate>{children}</SignedInGate>
      </main>
    </>
  );
}
