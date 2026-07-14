import { MemberRole } from "@/generated/prisma/enums";
import { badRequest, noContent, notFound, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isForeignKeyViolation, isNotFound } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { updateMenuItemSchema } from "@/lib/validations/menu";

type Params = { itemId: string };

/** Editing the menu is a manager's job; a waiter should not be able to reprice a dish. */
const MANAGES_MENU = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const PATCH = withTenant<Params>(
  async (req, { restaurantId, params }) => {
    const parsed = await parseJson(req, updateMenuItemSchema);
    if (!parsed.ok) return parsed.response;

    const { categoryId, ...rest } = parsed.data;

    // A body-supplied categoryId could name ANOTHER tenant's category. The composite FK
    // makes storing it impossible, but that would surface as a raw FK error — check and
    // answer properly.
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

    try {
      // The compound unique @@unique([id, restaurantId]) puts the tenant filter INSIDE
      // the WHERE clause of a single statement. `update({ where: { id } })` keys on the
      // id alone and would happily edit another tenant's row if you guessed an id.
      //
      // One round trip, and no read-after-write gap: an updateMany followed by a
      // findFirst can have the row deleted in between, returning 200 with a null body.
      const item = await prisma.menuItem.update({
        where: { id_restaurantId: { id: params.itemId, restaurantId } },
        data: {
          ...rest,
          // categoryId is tri-state: absent = leave alone, null = uncategorise, id = move.
          ...(categoryId === undefined ? {} : { categoryId }),
        },
        include: { category: { select: { id: true, name: true } } },
      });

      return ok(item);
    } catch (error) {
      if (isNotFound(error)) return notFound("No such menu item");
      throw error;
    }
  },
  { roles: MANAGES_MENU },
);

export const DELETE = withTenant<Params>(
  async (_req, { restaurantId, params }) => {
    try {
      await prisma.menuItem.delete({
        where: { id_restaurantId: { id: params.itemId, restaurantId } },
      });
    } catch (error) {
      if (isNotFound(error)) return notFound("No such menu item");

      // OrderItem(menuItemId, restaurantId) -> MenuItem is ON DELETE RESTRICT. A dish
      // that has ever been ordered CANNOT be deleted, and that is the point: order
      // history is the books, and a line item pointing at a dish that no longer exists is
      // a corrupt ledger. The affordance for "stop selling this" is isAvailable = false.
      //
      // This arrives as a raw DriverAdapterError (SQLSTATE 23001), NOT Prisma's P2003 —
      // see src/lib/db-errors.ts. Matching on P2003 alone silently 500s.
      if (isForeignKeyViolation(error)) {
        return badRequest(
          "This item appears in past orders, so it can't be deleted. Mark it unavailable instead.",
        );
      }
      throw error;
    }

    return noContent();
  },
  { roles: MANAGES_MENU },
);
