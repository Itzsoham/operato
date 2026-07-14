import { MemberRole } from "@/generated/prisma/enums";
import { badRequest, noContent, notFound, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isForeignKeyViolation, isNotFound } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { updateCategorySchema } from "@/lib/validations/menu";

type Params = { categoryId: string };

const MANAGES_MENU = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const PATCH = withTenant<Params>(
  async (req, { restaurantId, params }) => {
    const parsed = await parseJson(req, updateCategorySchema);
    if (!parsed.ok) return parsed.response;

    try {
      // Compound unique -> the tenant filter is in the WHERE clause of a single
      // statement. `update({ where: { id } })` keys on the id alone and would edit
      // another tenant's row if you guessed an id.
      const category = await prisma.menuCategory.update({
        where: { id_restaurantId: { id: params.categoryId, restaurantId } },
        data: parsed.data,
        include: { _count: { select: { menuItems: true } } },
      });

      return ok(category);
    } catch (error) {
      if (isNotFound(error)) return notFound("No such category");
      throw error;
    }
  },
  { roles: MANAGES_MENU },
);

export const DELETE = withTenant<Params>(
  async (_req, { restaurantId, params }) => {
    try {
      await prisma.menuCategory.delete({
        where: { id_restaurantId: { id: params.categoryId, restaurantId } },
      });
    } catch (error) {
      if (isNotFound(error)) return notFound("No such category");

      // MenuItem(categoryId, restaurantId) -> MenuCategory is ON DELETE RESTRICT, so
      // Postgres refuses to orphan the items. That is the behaviour we want; translate
      // it instead of letting it surface as a 500.
      if (isForeignKeyViolation(error)) {
        return badRequest("Move or remove this category's items before deleting it.");
      }
      throw error;
    }

    return noContent();
  },
  { roles: MANAGES_MENU },
);
