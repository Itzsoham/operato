import { MemberRole } from "@/generated/prisma/enums";
import { badRequest, noContent, notFound, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isForeignKeyViolation, isNotFound, isUniqueViolation } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { updateTableSchema } from "@/lib/validations/orders";

type Params = { tableId: string };

const MANAGES_FLOOR = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const PATCH = withTenant<Params>(
  async (req, { restaurantId, params }) => {
    const parsed = await parseJson(req, updateTableSchema);
    if (!parsed.ok) return parsed.response;

    try {
      // Compound unique -> the tenant filter is inside the WHERE of a single statement.
      const table = await prisma.restaurantTable.update({
        where: { id_restaurantId: { id: params.tableId, restaurantId } },
        data: parsed.data,
      });
      return ok(table);
    } catch (error) {
      if (isNotFound(error)) return notFound("No such table");
      if (isUniqueViolation(error, "number")) {
        return Response.json(
          { error: "Validation failed", fieldErrors: { number: "That table number is taken." } },
          { status: 422 },
        );
      }
      throw error;
    }
  },
  { roles: MANAGES_FLOOR },
);

export const DELETE = withTenant<Params>(
  async (_req, { restaurantId, params }) => {
    try {
      await prisma.restaurantTable.delete({
        where: { id_restaurantId: { id: params.tableId, restaurantId } },
      });
    } catch (error) {
      if (isNotFound(error)) return notFound("No such table");

      // Order(tableId, restaurantId) -> RestaurantTable is ON DELETE RESTRICT. A table
      // that appears in order history cannot be removed — the same reason a sold dish
      // cannot be: it would leave orders pointing at a table that never existed.
      if (isForeignKeyViolation(error)) {
        return badRequest(
          "This table appears in past orders, so it can't be deleted. Mark it inactive instead.",
        );
      }
      throw error;
    }

    return noContent();
  },
  { roles: MANAGES_FLOOR },
);
