import { MemberRole } from "@/generated/prisma/enums";
import { created, escapeLike, invalid, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { createMenuItemSchema, listMenuItemsSchema } from "@/lib/validations/menu";

// Reading the menu is every member's business. CHANGING it is not.
const MANAGES_MENU = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const GET = withTenant(async (req, { restaurantId }) => {
  const url = new URL(req.url);
  const parsed = listMenuItemsSchema.safeParse({
    categoryId: url.searchParams.get("categoryId"),
    search: url.searchParams.get("search"),
    available: url.searchParams.get("available"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const { categoryId, search, available } = parsed.data;

  const items = await prisma.menuItem.findMany({
    where: {
      restaurantId, // tenant filter first, always
      ...(categoryId ? { categoryId } : {}),
      ...(available ? { isAvailable: available === "true" } : {}),
      ...(search ? { name: { contains: escapeLike(search), mode: "insensitive" } } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { category: { select: { id: true, name: true } } },
  });

  return ok(items);
});

export const POST = withTenant(
  async (req, { restaurantId }) => {
    const parsed = await parseJson(req, createMenuItemSchema);
    if (!parsed.ok) return parsed.response;

    const { categoryId, ...rest } = parsed.data;

    // A categoryId in the BODY is attacker-controlled: it could name another tenant's
    // category. The composite FK (categoryId, restaurantId) -> MenuCategory(id,
    // restaurantId) makes that physically impossible to store — but it would surface as a
    // raw FK error, so check first and answer properly.
    if (categoryId) {
      const owned = await prisma.menuCategory.count({
        where: { id: categoryId, restaurantId },
      });
      if (owned === 0) {
        return Response.json(
          { error: "Validation failed", fieldErrors: { categoryId: "No such category" } },
          { status: 422 },
        );
      }
    }

    const sortOrder =
      parsed.data.sortOrder ?? (await prisma.menuItem.count({ where: { restaurantId } }));

    const item = await prisma.menuItem.create({
      data: {
        ...rest,
        restaurantId, // from the URL, never the body
        categoryId: categoryId ?? null,
        sortOrder,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    return created(item);
  },
  { roles: MANAGES_MENU },
);
