"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client.
 *
 * In the browser (`typeof window !== "undefined"`), omitting baseURL allows Better Auth
 * to automatically make relative requests to `window.location.origin` (the current website domain).
 * This prevents hardcoding localhost into production client bundles during Next.js build time.
 */
export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? undefined
      : process.env.NEXT_PUBLIC_BETTER_AUTH_URL || process.env.BETTER_AUTH_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
