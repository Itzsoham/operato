import { MemberRole, OrderStatus, TableStatus } from "@/generated/prisma/enums";
import { badRequest, notFound, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { TX_OPTIONS } from "@/lib/orders/service";
import { setTableStatusSchema } from "@/lib/validations/orders";

type Params = { tableId: string };

/**
 * Set a table RESERVED / INACTIVE / AVAILABLE by hand.
 *
 * Separate from the floor-plan PATCH on purpose. Table status is DERIVED state that the
 * order service maintains under a row lock; a status field on the general-purpose PATCH
 * was a fourth, unlocked writer into it — able to mark a table free with a live order
 * sitting on it. OCCUPIED is not settable here at all: it is the consequence of an order
 * existing, not a decision anyone makes.
 */
export const PATCH = withTenant<Params>(
  async (req, { restaurantId, params }) => {
    const parsed = await parseJson(req, setTableStatusSchema);
    if (!parsed.ok) return parsed.response;

    const next = parsed.data.status;

    const result = await prisma.$transaction(async (tx) => {
      // Same serialisation point the order service uses. Without the lock, a concurrent
      // order create could seat this table between our check and our write.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "RestaurantTable"
         WHERE id = ${params.tableId} AND "restaurantId" = ${restaurantId}
         FOR UPDATE`;
      if (!rows[0]) return { error: "notFound" as const };

      const live = await tx.order.count({
        where: {
          restaurantId,
          tableId: params.tableId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      });

      // A table with people at it is not free, not reservable, and not decommissioned.
      // Settle or cancel the order first.
      if (live > 0) return { error: "busy" as const };

      await tx.restaurantTable.update({
        where: { id_restaurantId: { id: params.tableId, restaurantId } },
        data: { status: next satisfies TableStatus },
      });

      return { error: null };
    }, TX_OPTIONS);

    if (result.error === "notFound") return notFound("No such table");
    if (result.error === "busy") {
      return badRequest("There's a live order on that table. Settle or cancel it first.");
    }

    const table = await prisma.restaurantTable.findUniqueOrThrow({
      where: { id_restaurantId: { id: params.tableId, restaurantId } },
    });

    return ok(table);
  },
  { roles: [MemberRole.OWNER, MemberRole.MANAGER, MemberRole.STAFF] },
);
