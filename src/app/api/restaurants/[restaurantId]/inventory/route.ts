import { MemberRole } from "@/generated/prisma/enums";
import { created, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isUniqueViolation } from "@/lib/db-errors";
import { createInventoryItem, getStockLines } from "@/lib/inventory/service";
import { createInventoryItemSchema } from "@/lib/validations/inventory";

export const maxDuration = 30; // must exceed TX_OPTIONS.timeout — see orders/route.ts

// Anyone on shift can see the store and move stock. Adding or removing an item from the
// catalogue is a manager's decision.
const MANAGES_CATALOGUE = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const GET = withTenant(async (_req, { restaurantId }) => {
  // Stock levels WITH velocity — see getStockLines. "8kg of chicken" is not information;
  // "8kg, and you get through 6 a day" is.
  return ok(await getStockLines(restaurantId));
});

export const POST = withTenant(
  async (req, { restaurantId, userId }) => {
    const parsed = await parseJson(req, createInventoryItemSchema);
    if (!parsed.ok) return parsed.response;

    try {
      // Opening stock is booked as a real STOCK_IN movement, not written onto the
      // balance — otherwise the ledger starts from a number no transaction accounts for
      // and SUM(delta) = currentStock is false from the first day.
      const item = await createInventoryItem(restaurantId, parsed.data, userId);
      return created(item);
    } catch (error) {
      // @@unique([restaurantId, name]) — two "Chicken" rows would split the ledger in
      // half and make "how much chicken do we have" ambiguous, to the reorder list and to
      // the AI answering it.
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
