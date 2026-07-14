"use server";

import { redirect } from "next/navigation";

import { MemberRole } from "@/generated/prisma/enums";
import { isUniqueViolation } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { createRestaurantSchema } from "@/lib/validations/auth";

export type OnboardingState = {
  errors?: { name?: string; slug?: string; form?: string };
};

/**
 * How many restaurants one account may OWN.
 *
 * A Server Action is a public POST endpoint — anything with a session cookie can drive
 * it in a loop, form or no form. `requireSession()` authenticates WHO; it says nothing
 * about HOW MANY. Better Auth's rate limiter only guards `/api/auth/*` and never sees
 * this route, so without a cap one free account can mint unlimited tenants on the
 * shared database. That is everyone's problem, not just theirs.
 */
const OWNED_RESTAURANT_LIMIT = 5;

class RestaurantLimitError extends Error {}

/**
 * Creates a restaurant and makes the current user its OWNER — in ONE transaction.
 *
 * These two writes cannot be allowed to come apart. A Restaurant with no
 * RestaurantMember is a tenant nobody can reach: `requireMember` would 403 its own
 * creator, and there is no UI to repair it. Better Auth owns the user table directly,
 * so unlike the Clerk design this project started from, there is no webhook to
 * reconcile it later either — the transaction IS the reconciliation.
 */
export async function createRestaurant(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  // The user id comes from the session cookie, never from the form. FormData is
  // attacker-controlled; it may only carry `name` and `slug`.
  const session = await requireSession();

  const parsed = createRestaurantSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });

  if (!parsed.success) {
    const errors: OnboardingState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "name" || key === "slug") errors[key] ??= issue.message;
    }
    return { errors };
  }

  const { name, slug } = parsed.data;
  let restaurantId: string;

  try {
    const restaurant = await prisma.$transaction(async (tx) => {
      const owned = await tx.restaurantMember.count({
        where: { userId: session.user.id, role: MemberRole.OWNER },
      });
      // READ COMMITTED makes this count racy under concurrent calls, so it bounds
      // overshoot rather than enforcing an exact ceiling. Bounding is the point.
      if (owned >= OWNED_RESTAURANT_LIMIT) throw new RestaurantLimitError();

      const created = await tx.restaurant.create({
        data: { name, slug },
        select: { id: true },
      });

      await tx.restaurantMember.create({
        data: {
          restaurantId: created.id,
          userId: session.user.id,
          role: MemberRole.OWNER,
        },
      });

      return created;
    });
    restaurantId = restaurant.id;
  } catch (error) {
    if (error instanceof RestaurantLimitError) {
      return {
        errors: {
          form: `You can own up to ${OWNED_RESTAURANT_LIMIT} restaurants. Contact us if you need more.`,
        },
      };
    }

    // Don't pre-check the slug and then insert — that read-then-write race lets two
    // simultaneous signups both see "free" and one blow up. Let the unique index be the
    // arbiter and translate its complaint, checking WHICH constraint tripped so that
    // adding a unique column later cannot start blaming the slug for an unrelated one.
    //
    // isUniqueViolation matches BOTH Prisma's P2002 and the raw SQLSTATE 23505: on
    // Prisma 7's driver adapter a constraint violation often arrives as a
    // DriverAdapterError with no P-code at all (see src/lib/db-errors.ts), so matching
    // P2002 alone would 500 on a duplicate slug instead of saying "that one's taken".
    if (isUniqueViolation(error, "slug")) {
      return { errors: { slug: "That address is taken. Try another." } };
    }
    throw error;
  }

  // Outside the try: redirect() works by throwing, so catching around it would swallow
  // the navigation and report a successful create as a failure.
  redirect(`/${restaurantId}`);
}
