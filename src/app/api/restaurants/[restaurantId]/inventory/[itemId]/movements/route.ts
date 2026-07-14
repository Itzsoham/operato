import { MemberRole, TransactionType } from "@/generated/prisma/enums";
import { created, invalid, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { InventoryError, applyMovement } from "@/lib/inventory/service";
import { createMovementSchema, listMovementsSchema } from "@/lib/validations/inventory";

type Params = { itemId: string };

export const maxDuration = 30; // must exceed TX_OPTIONS.timeout

/** The audit trail for one item: what moved, by how much, WHO moved it, and the balance after. */
export const GET = withTenant<Params>(async (req, { restaurantId, params }) => {
  const url = new URL(req.url);
  const parsed = listMovementsSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  const movements = await prisma.inventoryTransaction.findMany({
    where: { inventoryItemId: params.itemId, restaurantId }, // tenant-filtered, always
    // seq, NOT createdAt. createdAt is TIMESTAMP(3), so two movements in the same
    // millisecond tie and the ledger renders its balances out of order — looking broken
    // even though the data is right. seq is allocated at INSERT, which under the item's
    // row lock IS apply order.
    orderBy: { seq: "desc" },
    take: parsed.data.limit,
    include: { user: { select: { name: true } } },
  });

  return ok(movements);
});

/**
 * Moves stock.
 *
 * DELIVERIES, USE AND WASTE are open to every member. The person who spots the spoiled
 * milk is the one who should record it, and making them find a manager first is how waste
 * goes unrecorded and the ledger quietly stops matching the shelf. All three are bounded:
 * you cannot take out more than is on the shelf.
 *
 * A STOCK-TAKE IS NOT BOUNDED. It is the only unrestricted write to the balance — it can
 * set stock to any absolute value, up or down. "Take 5kg, then post a count 5kg lower" is
 * the entire fraud and it needs no cover story. In every real inventory system a
 * stock-take is a management act; it is one here too.
 */
export const POST = withTenant<Params>(async (req, { restaurantId, params, userId, role }) => {
  const parsed = await parseJson(req, createMovementSchema);
  if (!parsed.ok) return parsed.response;

  // This cannot live in withTenant's `roles` option: one route serves both kinds of
  // movement, and only one of them is restricted.
  if (parsed.data.type === TransactionType.ADJUSTMENT && role === MemberRole.STAFF) {
    return new Response("Only an owner or manager can record a stock take.", { status: 403 });
  }

  try {
    // The lock, the balance arithmetic, the signed delta and the ledger row all live in
    // the service, in one transaction. See src/lib/inventory/service.ts.
    const movement = await applyMovement(restaurantId, params.itemId, parsed.data, userId);
    return created(movement);
  } catch (error) {
    if (error instanceof InventoryError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
});
