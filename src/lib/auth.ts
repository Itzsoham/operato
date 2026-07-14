import "server-only"; // never let the auth instance (and its secret) into a client bundle

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/lib/db";

// Better Auth owns the user/session/account/verification tables directly in OUR
// Postgres — there is no external user-sync webhook to keep in step (that was the
// Clerk design). Membership lives in our own `RestaurantMember` table, keyed by
// `user.id`; see requireMember() for how a request is bound to a tenant.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Google sign-in is opt-in, but a HALF-configured pair is always a mistake — fail
// loudly rather than quietly serving a site whose Google button does not exist.
const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
if (Boolean(googleId) !== Boolean(googleSecret)) {
  throw new Error(
    "Set BOTH GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither — exactly one is set.",
  );
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  // Explicit, and required. Left unset, Better Auth falls back to deriving the origin
  // from the INCOMING REQUEST — so the CSRF origin check would validate a request
  // against an origin taken from that same request, degrading quietly instead of
  // failing. Pin it, and refuse to boot without it.
  baseURL: required("BETTER_AUTH_URL"),
  trustedOrigins: [required("BETTER_AUTH_URL")],

  emailAndPassword: {
    enabled: true,
  },

  socialProviders:
    googleId && googleSecret
      ? { google: { clientId: googleId, clientSecret: googleSecret } }
      : undefined,

  // Must be last: lets Server Actions set the session cookie.
  plugins: [nextCookies()],
});
