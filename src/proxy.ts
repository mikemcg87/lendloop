import { clerkMiddleware } from "@clerk/nextjs/server";

// Only attaches Clerk auth state to the request. Signed-in pages call
// auth.protect() in their own layout, and the real access control lives in
// the Convex functions.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
