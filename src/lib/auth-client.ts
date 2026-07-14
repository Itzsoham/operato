"use client";

import { createAuthClient } from "better-auth/react";

// Browser-side Better Auth. The URL is the PUBLIC one — this file ships to the client,
// so nothing secret may appear here. Sessions travel as httpOnly cookies; the client
// never sees a token it could leak.
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
