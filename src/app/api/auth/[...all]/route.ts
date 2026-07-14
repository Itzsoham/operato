import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

// Better Auth's own endpoints (sign-in, sign-up, OAuth callbacks, session).
// This is the ONE route tree under /api that is intentionally unauthenticated —
// everything under /api/restaurants/[restaurantId] must call requireMember().
export const { GET, POST } = toNextJsHandler(auth);
