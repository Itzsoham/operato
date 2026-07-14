import { MemberRole } from "@/generated/prisma/enums";
import { withTenant } from "@/lib/auth-guard";
import { created, ok, parseJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createCategorySchema } from "@/lib/validations/menu";

// withTenant runs requireMember(restaurantId) BEFORE the handler and returns 401/403 on
// a miss. It is not decoration — a layout does not run for route handlers, so this call
// is the only thing standing between an authenticated user and every other tenant's data.
//
// Reading the menu is every member's business. CHANGING it is not: a waiter should not
// be able to reprice a dish or delete a category.
const MANAGES_MENU = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const GET = withTenant(async (_req, { restaurantId }) => {
  const categories = await prisma.menuCategory.findMany({
    where: { restaurantId }, // tenant filter on EVERY query, no exceptions
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { menuItems: true } } },
  });

  return ok(categories);
});

export const POST = withTenant(
  async (req, { restaurantId }) => {
    const parsed = await parseJson(req, createCategorySchema);
    if (!parsed.ok) return parsed.response;

    // Append to the end unless the caller says otherwise. Two concurrent creates can
    // land on the same sortOrder — harmless, since `name` is the tiebreaker in the sort.
    const sortOrder =
      parsed.data.sortOrder ??
      (await prisma.menuCategory.count({ where: { restaurantId } }));

    const category = await prisma.menuCategory.create({
      // restaurantId comes from the URL — never from the body, which is
      // attacker-controlled. The Zod schema does not even have the field.
      data: { restaurantId, name: parsed.data.name, sortOrder },
      include: { _count: { select: { menuItems: true } } },
    });

    return created(category);
  },
  { roles: MANAGES_MENU },
);
