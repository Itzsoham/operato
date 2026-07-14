import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { TransactionType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { CreateMovementInput } from "@/lib/validations/inventory";

/** See src/lib/orders/service.ts — the database must give up before the platform does. */
export const TX_OPTIONS = { maxWait: 8_000, timeout: 12_000 } as const;

export class InventoryError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

const D = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value);

/**
 * Applies one stock movement, and records it.
 *
 * THE INVARIANT THIS PROTECTS:
 *
 *     balanceAfter[n] === balanceAfter[n-1] ± quantity[n]        (row to row)
 *     SUM(signed movements) === InventoryItem.currentStock       (ledger to balance)
 *
 * `currentStock` and `balanceAfter` are two copies of the same truth. If they can drift,
 * the audit trail is not an audit trail — it is a story about what might have happened.
 *
 * THE RACE: two movements land at once. The kitchen takes 3 kg out while a delivery of
 * 10 kg is booked in. Both read `currentStock = 12`. One writes 9, the other writes 22,
 * and the last write wins — 3 kg or 10 kg simply vanishes, and both transaction rows
 * claim a `balanceAfter` that no longer matches the item. A read-modify-write without a
 * lock is not "unlikely to collide"; it is a lost update waiting for a busy service.
 *
 * `SELECT ... FOR UPDATE` on the item row serialises them, so the second reads the
 * first's committed balance. This is the same shape as payOrder's customer rollup.
 */
export async function applyMovement(
  restaurantId: string,
  itemId: string,
  input: CreateMovementInput,
  /** WHO moved it. An audit trail without an actor doesn't answer the question it exists for. */
  userId: string,
) {
  const txnId = await prisma.$transaction(async (tx) => {
    // Lock the item row and read its balance.
    //
    // NOTE the type: `currentStock` is declared STRING, not Decimal. A raw query goes
    // through the pg driver, which returns `numeric` as a JS string — Prisma's mapping
    // does not apply. Typing it Decimal compiles, and then `.sub()` is a runtime
    // TypeError on the stock ledger. Normalise at the boundary, every time.
    const rows = await tx.$queryRaw<{ id: string; currentStock: string; name: string }[]>`
      SELECT id, "currentStock", name
        FROM "InventoryItem"
       WHERE id = ${itemId} AND "restaurantId" = ${restaurantId}
       FOR UPDATE`;

    const item = rows[0];
    if (!item) throw new InventoryError(404, "No such inventory item.");

    const balance = D(item.currentStock); // string -> Decimal, at the boundary

    let delta: Prisma.Decimal;
    let recordedQuantity: Prisma.Decimal;

    if (input.type === TransactionType.ADJUSTMENT) {
      // A stock-take states the truth: this is what was on the shelf. The delta is
      // whatever it takes to get there — computed HERE, under the lock, against the
      // balance as it actually is, not as it looked when the form was opened.
      //
      // A ZERO delta is recorded, not rejected. "We counted, and the books were right"
      // is the single most valuable audit event there is — refusing it means the ledger
      // cannot tell a verified item from one nobody has ever checked.
      const counted = D(input.countedStock);
      delta = counted.sub(balance);
      recordedQuantity = delta.abs();
    } else {
      const quantity = D(input.quantity);
      const outbound =
        input.type === TransactionType.STOCK_OUT || input.type === TransactionType.WASTE;
      delta = outbound ? quantity.negated() : quantity;
      recordedQuantity = quantity;

      // You cannot take out what is not there.
      //
      // The alternative — silently clamping the balance at zero while recording the full
      // quantity — is what breaks a ledger: the row then claims "took 12 from a stock of
      // 9", and balanceAfter no longer equals the previous balance minus the quantity.
      // (That exact bug shipped in the seed and was caught in review.) If the shelf really
      // is short, an ADJUSTMENT is the honest way to say so.
      if (outbound && quantity.greaterThan(balance)) {
        throw new InventoryError(
          409,
          `Only ${balance.toString()} left of “${item.name}”. Record an adjustment if the count is wrong.`,
        );
      }
    }

    const balanceAfter = balance.add(delta);

    // Decimal(10,3) tops out at 9,999,999.999. A delivery onto a nearly-full shelf can
    // exceed it, and Postgres would answer with a raw numeric-overflow (22003) — an
    // unhandled 500 with a driver error in it. The transaction aborts either way, so the
    // ledger stays consistent; this just makes the refusal legible.
    if (balanceAfter.greaterThan("9999999.999")) {
      throw new InventoryError(422, "That would put the stock level past what we can record.");
    }

    await tx.inventoryItem.update({
      where: { id_restaurantId: { id: itemId, restaurantId } },
      data: { currentStock: balanceAfter },
    });

    const created = await tx.inventoryTransaction.create({
      data: {
        inventoryItemId: itemId,
        restaurantId, // composite FK pins this to the item's tenant
        type: input.type,
        quantity: recordedQuantity, // positive magnitude, for display
        delta, // SIGNED — this is the one that reconciles. See the schema.
        balanceAfter, // written from the SAME number we set on the item
        userId, // who did it
        notes: input.notes ?? null,
      },
      select: { id: true },
    });

    return created.id;
  }, TX_OPTIONS);

  // Outside the lock — this read needs none, and holding the item row across it would
  // make every other movement on this item wait.
  return prisma.inventoryTransaction.findUniqueOrThrow({
    where: { id: txnId },
    include: { inventoryItem: { select: { id: true, name: true, unit: true } } },
  });
}

/**
 * Creates an item, and books its opening stock as a real movement.
 *
 * The opening balance is NOT written straight onto the item. If it were, the ledger would
 * start from a number no transaction accounts for, and `SUM(movements) === currentStock`
 * would be false from the first day. Every unit has to enter through the door.
 */
export async function createInventoryItem(
  restaurantId: string,
  input: {
    name: string;
    unit: string;
    lowStockThreshold: number;
    costPerUnit?: number | null;
    supplier?: string | null;
    openingStock: number;
  },
  userId: string,
) {
  const itemId = await prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.create({
      data: {
        restaurantId, // from the URL, never the body
        name: input.name,
        unit: input.unit,
        lowStockThreshold: input.lowStockThreshold,
        costPerUnit: input.costPerUnit ?? null,
        supplier: input.supplier ?? null,
        currentStock: 0, // every unit enters through a movement
      },
      select: { id: true },
    });

    if (input.openingStock > 0) {
      const opening = D(input.openingStock);
      await tx.inventoryItem.update({
        where: { id_restaurantId: { id: item.id, restaurantId } },
        data: { currentStock: opening },
      });
      await tx.inventoryTransaction.create({
        data: {
          inventoryItemId: item.id,
          restaurantId,
          type: TransactionType.STOCK_IN,
          quantity: opening,
          delta: opening, // signed; inbound
          balanceAfter: opening,
          userId,
          notes: "Opening stock",
        },
      });
    }

    return item.id;
  }, TX_OPTIONS);

  return prisma.inventoryItem.findUniqueOrThrow({
    where: { id_restaurantId: { id: itemId, restaurantId } },
  });
}

export type StockLine = {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  costPerUnit: number | null;
  supplier: string | null;
  /** Average units consumed per day over the window. */
  dailyUsage: number;
  /** How many days of cover is left at that rate. null = not moving. */
  daysLeft: number | null;
  needsReorder: boolean;
};

const VELOCITY_WINDOW_DAYS = 28;

/**
 * Stock, with the velocity that makes it mean something.
 *
 * "You have 8 kg of chicken" is not information. "You have 8 kg of chicken and you get
 * through 6 a day" is. This is deliberately ARITHMETIC, not an AI call: the reorder
 * question has an exact answer, and asking a language model to divide two numbers would
 * be slower, cost money, and occasionally be wrong.
 *
 * One query for the whole list — computing velocity per item in a loop would be an N+1
 * over a slow link.
 */
export async function getStockLines(restaurantId: string): Promise<StockLine[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string;
      unit: string;
      currentStock: string;
      lowStockThreshold: string;
      costPerUnit: string | null;
      supplier: string | null;
      consumed: string | null;
      windowDays: string;
    }[]
  >`
    SELECT i.id,
           i.name,
           i.unit,
           i."currentStock",
           i."lowStockThreshold",
           i."costPerUnit",
           i.supplier,
           -- What actually LEFT the shelf in the window.
           --
           -- SUM(-delta) over OUTFLOWS, not SUM(quantity) over a type list: a negative
           -- ADJUSTMENT (a stock-take that found less than the books claimed) is real
           -- consumption — the stuff is gone. Counting only STOCK_OUT/WASTE would show an
           -- item quietly draining through shrinkage as having zero usage, and therefore
           -- infinite days of cover.
           --
           -- Deliveries and upward corrections are excluded: the delta < 0 filter does
           -- that on its own, and counting a big delivery as demand would be nonsense.
           (SELECT SUM(-t.delta)
              FROM "InventoryTransaction" t
             WHERE t."inventoryItemId" = i.id
               AND t."restaurantId" = ${restaurantId}
               AND t.delta < 0
               AND t."createdAt" >= NOW() - make_interval(days => ${VELOCITY_WINDOW_DAYS})
           ) AS consumed,
           -- Divide by the item's ACTUAL age, capped at the window. An item added three
           -- days ago that has burned 30kg is using 10/day, not 30/28 = 1.07/day — and it
           -- is precisely the new item nobody has a feel for whose reorder alert must not
           -- fire nine times too late.
           GREATEST(1, LEAST(
             ${VELOCITY_WINDOW_DAYS},
             EXTRACT(DAY FROM (NOW() - i."createdAt"))
           ))::text AS "windowDays"
      FROM "InventoryItem" i
     WHERE i."restaurantId" = ${restaurantId}
     ORDER BY i.name ASC`;

  return rows.map((row) => {
    // Every numeric column arrives as a STRING from the raw driver — see applyMovement.
    const currentStock = Number(row.currentStock);
    const lowStockThreshold = Number(row.lowStockThreshold);
    const consumed = Number(row.consumed ?? 0);
    const windowDays = Number(row.windowDays);

    const dailyUsage = consumed / windowDays;

    // An item nobody is using has no "days left" — it has forever. Dividing by zero and
    // calling the answer Infinity would sort it to the top of a reorder list, which is
    // the opposite of the truth.
    const daysLeft = dailyUsage > 0 ? currentStock / dailyUsage : null;

    return {
      id: row.id,
      name: row.name,
      unit: row.unit,
      currentStock,
      lowStockThreshold,
      costPerUnit: row.costPerUnit === null ? null : Number(row.costPerUnit),
      supplier: row.supplier,
      dailyUsage: Math.round(dailyUsage * 1000) / 1000,
      daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
      needsReorder: currentStock < lowStockThreshold,
    };
  });
}
