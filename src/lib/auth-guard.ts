import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { MemberRole } from "@/generated/prisma/enums";

/**
 * Thrown by the guards below. NOT a `Response`: Next.js route handlers must RETURN
 * a Response — a thrown one is just an unhandled error, and the caller gets a 500
 * with a stack trace instead of a 401/403. (That idiom is Remix's, not Next's.)
 * `withTenant` converts this into a real returned Response.
 */
export class AuthError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? "Unauthorized" : "Forbidden");
    this.name = "AuthError";
  }
}

/**
 * The tenant ownership guard. EVERY route handler under
 * `src/app/api/restaurants/[restaurantId]/**` must call this first — no exceptions.
 *
 * `layout.tsx` does NOT protect route handlers: a React layout runs only for the page
 * segment tree, so without this call any authenticated user could read or write ANY
 * restaurant's data just by changing the id in the URL.
 *
 * `restaurantId` must come from the URL param, never the request body — a body-supplied
 * id is attacker-controlled and would let a member of restaurant A act on restaurant B.
 */
export async function requireMember(restaurantId: string): Promise<{
  userId: string;
  role: MemberRole;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw new AuthError(401);
  }

  const member = await prisma.restaurantMember.findUnique({
    where: {
      restaurantId_userId: { restaurantId, userId: session.user.id },
    },
    select: { role: true },
  });

  // Deliberately 403 (not 404) for a non-existent restaurant too: distinguishing
  // "no such restaurant" from "not your restaurant" leaks which tenants exist.
  if (!member) {
    throw new AuthError(403);
  }

  return { userId: session.user.id, role: member.role };
}

/**
 * Same guard, plus a role check — for destructive or billing operations that a STAFF
 * member should not be able to perform.
 */
export async function requireRole(
  restaurantId: string,
  allowed: readonly MemberRole[],
): Promise<{ userId: string; role: MemberRole }> {
  const membership = await requireMember(restaurantId);
  if (!allowed.includes(membership.role)) {
    throw new AuthError(403);
  }
  return membership;
}

/**
 * Wraps a tenant-scoped route handler: runs `requireMember` first, hands the handler
 * the verified membership, and turns an AuthError into a RETURNED 401/403.
 *
 * Using this is what keeps the guard from being forgotten — the handler cannot run
 * without it, because the membership it needs only arrives through this wrapper.
 *
 *   export const GET = withTenant(async (_req, { restaurantId }) => {
 *     const items = await prisma.menuItem.findMany({ where: { restaurantId } });
 *     return Response.json(items);
 *   });
 */
/**
 * `P` is the route's OTHER dynamic segments — `{ itemId }` for
 * /menu/items/[itemId], and nothing at all for a collection route.
 *
 * The default must be an empty object type, NOT Record<string, never>: intersecting
 * that with { restaurantId: string } demands `restaurantId: never`, and Next 16
 * type-checks each handler against a generated signature, so the build fails with a
 * genuinely baffling error.
 */
export function withTenant<P extends object = Record<never, never>>(
  handler: (
    req: Request,
    ctx: {
      restaurantId: string;
      userId: string;
      role: MemberRole;
      params: P & { restaurantId: string };
    },
  ) => Promise<Response>,
  options?: { roles?: readonly MemberRole[] },
) {
  return async (
    req: Request,
    // Next 16: route params are a Promise and must be awaited.
    segment: { params: Promise<P & { restaurantId: string }> },
  ): Promise<Response> => {
    const params = await segment.params;
    const { restaurantId } = params;
    try {
      const membership = options?.roles
        ? await requireRole(restaurantId, options.roles)
        : await requireMember(restaurantId);
      return await handler(req, { restaurantId, ...membership, params });
    } catch (error) {
      if (error instanceof AuthError) {
        return new Response(error.message, { status: error.status });
      }
      throw error;
    }
  };
}
