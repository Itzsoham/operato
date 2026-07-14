import { MemberRole } from "@/generated/prisma/enums";
import { badRequest, noContent, notFound, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isNotFound, isUniqueViolation } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { updateInventoryItemSchema } from "@/lib/validations/inventory";

type Params = { itemId: string };

const MANAGES_CATALOGUE = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const GET = withTenant<Params>(async (_req, { restaurantId, params }) => {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: params.itemId, restaurantId },
  });
  if (!item) return notFound("No such inventory item");
  return ok(item);
});

/**
 * Edits the item's DETAILS. Deliberately cannot touch `currentStock`: moving stock is a
 * MOVEMENT, recorded in the ledger under a row lock. A PATCH able to set the balance
 * directly would let anyone rewrite it with no transaction to explain it — which is
 * exactly what `balanceAfter` exists to make impossible.
 */
export const PATCH = withTenant<Params>(
  async (req, { restaurantId, params }) => {
    const parsed = await parseJson(req, updateInventoryItemSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const item = await prisma.inventoryItem.update({
        where: { id_restaurantId: { id: params.itemId, restaurantId } },
        data: parsed.data,
      });
      return ok(item);
    } catch (error) {
      if (isNotFound(error)) return notFound("No such inventory item");
      if (isUniqueViolation(error, "name")) {
        return Response.json(
          { error: "Validation failed", fieldErrors: { name: "You already track that item." } },
          { status: 422 },
        );
      }
      throw error;
    }
  },
  { roles: MANAGES_CATALOGUE },
);

export const DELETE = withTenant<Params>(
  async (_req, { restaurantId, params }) => {
    const item = await prisma.inventoryItem.findFirst({
      where: { id: params.itemId, restaurantId },
      select: { currentStock: true, unit: true },
    });
    if (!item) return notFound("No such inventory item");

    // Deleting an item CASCADES its whole ledger away. Refusing while stock remains means
    // the shelf has to be emptied through the ledger first — a WASTE or an ADJUSTMENT,
    // which LEAVES A ROW saying where it went. Otherwise a manager could erase an item,
    // its stock, and the record of the shrinkage they caused, in one call and with no
    // trace at all.
    if (!item.currentStock.isZero()) {
      return badRequest(
        `There are still ${item.currentStock.toString()} ${item.unit} on hand. Write it off or adjust to zero first — that leaves a record of where it went.`,
      );
    }

    await prisma.inventoryItem.delete({
      where: { id_restaurantId: { id: params.itemId, restaurantId } },
    });

    return noContent();
  },
  { roles: MANAGES_CATALOGUE },
);
