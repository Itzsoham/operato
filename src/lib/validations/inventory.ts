import { z } from "zod";

import { TransactionType } from "@/generated/prisma/enums";

// No `.default()` on any base that later gets `.partial()`d — Zod 4's partial does not
// strip a default, so a PATCH of one field would silently rewrite the others. That bug
// shipped once already (it flipped vegetarian dishes to non-vegetarian); see
// tests/unit/validations.test.ts.

/** Decimal(10,3) — stock is measured in kg/litres/pieces, to three places. */
const quantity = z
  .number({ error: "Enter a quantity" })
  .positive("Must be more than zero")
  .max(9_999_999.999, "That is too large")
  .multipleOf(0.001, "At most three decimal places");

const stockLevel = z
  .number()
  .nonnegative("Cannot be negative")
  .max(9_999_999.999, "That is too large")
  .multipleOf(0.001, "At most three decimal places");

const cost = z
  .number()
  .nonnegative("Cannot be negative")
  .max(99_999_999.99)
  .multipleOf(0.01, "At most two decimal places");

const inventoryItemFields = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80, "That name is too long"),
  unit: z.string().trim().min(1, "kg, litres, pieces…").max(20),
  lowStockThreshold: stockLevel,
  costPerUnit: cost.nullish(),
  supplier: z.string().trim().max(80).nullish(),
});

export const createInventoryItemSchema = inventoryItemFields.extend({
  /**
   * The OPENING stock. Note it is not `currentStock` — you cannot set the balance
   * directly, ever. It becomes an opening STOCK_IN movement, so the ledger accounts for
   * every unit from zero. A balance nobody can explain is not an audit trail.
   */
  openingStock: stockLevel.default(0),
  lowStockThreshold: stockLevel.default(10),
});

/**
 * Editing an item CANNOT touch its stock level. Moving stock is a MOVEMENT — it goes
 * through the ledger, under a row lock. A PATCH that could set `currentStock` would let
 * anyone rewrite the balance with no transaction to explain it, which is precisely the
 * thing `balanceAfter` exists to make impossible.
 */
export const updateInventoryItemSchema = inventoryItemFields.partial();

/**
 * A movement, as the caller states it.
 *
 * A DISCRIMINATED UNION, because an adjustment is not the same kind of thing as a
 * delivery. A delivery says "twelve more kilos arrived". A stock-take says "I counted
 * 8.5 kilos" — an absolute truth that supersedes whatever the books claimed. Modelling
 * the stock-take as a delta means the person at the shelf has to do the subtraction, and
 * if the books were already wrong the correction is wrong too, and the error survives the
 * very count that was meant to fix it.
 *
 * So: STOCK_IN / STOCK_OUT / WASTE carry a positive `quantity`; ADJUSTMENT carries the
 * `countedStock`, and the service works out the delta under the row lock.
 */
export const createMovementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(TransactionType.STOCK_IN),
    quantity,
    notes: z.string().trim().max(200).nullish(),
  }),
  z.object({
    type: z.literal(TransactionType.STOCK_OUT),
    quantity,
    notes: z.string().trim().max(200).nullish(),
  }),
  z.object({
    type: z.literal(TransactionType.WASTE),
    quantity,
    // REQUIRED. Stock destroyed with no reason given is stock that walked out of the
    // door, and an audit trail that lets you write it off silently is not one.
    notes: z.string().trim().min(1, "Say what happened to it").max(200),
  }),
  z.object({
    type: z.literal(TransactionType.ADJUSTMENT),
    /** What was actually on the shelf. Not a delta. */
    countedStock: stockLevel,
    // REQUIRED, for the same reason — and more so: a stock-take is the ONLY unbounded
    // write to the balance. It must say why the shelf disagreed with the books.
    notes: z.string().trim().min(1, "Say why the count differs").max(200),
  }),
]);

export const listMovementsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;
export type CreateMovementInput = z.infer<typeof createMovementSchema>;
