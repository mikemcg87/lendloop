import type { AuthConfig } from "convex/server";

// Clerk issues the JWT (template name "convex"); Convex verifies it against
// the issuer's JWKS. The template must include the custom claim
//   "role": "{{user.public_metadata.role}}"
// which convex/lib/auth.ts reads for RBAC.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
