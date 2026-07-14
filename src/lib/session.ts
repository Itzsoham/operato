import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { MemberRole } from "@/generated/prisma/enums";

/**
 * Page-level auth. Distinct from `requireMember` in auth-guard.ts on purpose:
 *
 *   - Pages REDIRECT an anonymous visitor to sign-in. That is the right UX.
 *   - Route handlers must RETURN 401/403. A redirect from an API call produces a
 *     confusing HTML response where the client expected JSON.
 *
 * These helpers never replace `requireMember` in a route handler. A layout or page
 * guard does not run for `app/api/**` — that is exactly the hole this project's own
 * review called out (plan-code-review.md Finding 6).
 */

/**
 * PUBLIC TO THE MEMBER. This crosses the server->client boundary — it is serialized
 * into the RSC payload and readable in the browser by anyone holding the session.
 *
 * Everything here is already a fact the user knows about their own memberships. Do NOT
 * widen it casually: adding `plan` for a billing badge, or reaching into
 * `restaurant: { select: { razorpaySubscriptionId } }`, ships that to every browser with
 * no signal at the boundary that anything changed.
 */
export type Membership = {
  restaurantId: string;
  role: MemberRole;
  name: string;
  slug: string;
};

/**
 * Deduped per request with React `cache`. A tenant page calls requireSession() and
 * then requirePageMember() (which needs the session again) — without this, one render
 * re-validates the session cookie against the database two or three times.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Redirects to sign-in if there is no session. Returns the user otherwise. */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * Every restaurant this user belongs to — the source for the restaurant switcher.
 *
 * cache()d per request: the tenant layout and the page it wraps BOTH guard themselves
 * (deliberately — see the layout), so without this the same findMany runs twice on
 * every dashboard render.
 */
export const getMemberships = cache(async (userId: string): Promise<Membership[]> => {
  const members = await prisma.restaurantMember.findMany({
    where: { userId },
    select: {
      restaurantId: true,
      role: true,
      restaurant: { select: { name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return members.map((m) => ({
    restaurantId: m.restaurantId,
    role: m.role,
    name: m.restaurant.name,
    slug: m.restaurant.slug,
  }));
});

/**
 * Page guard for a tenant-scoped route: signed in AND a member of THIS restaurant.
 *
 * A non-member gets 404, not 403. On a page, "forbidden" tells an attacker the
 * restaurant exists and they simply lack access — an existence oracle they can walk
 * through ids. The API layer answers 403 because a client there needs to distinguish
 * "log in again" from "not yours"; a browser does not.
 */
export async function requirePageMember(restaurantId: string): Promise<{
  userId: string;
  membership: Membership;
  memberships: Membership[];
}> {
  const session = await requireSession();
  const memberships = await getMemberships(session.user.id);
  const membership = memberships.find((m) => m.restaurantId === restaurantId);

  if (!membership) notFound();

  return { userId: session.user.id, membership, memberships };
}
