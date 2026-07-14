import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { ItemStatus, OrderStatus, OrderType, TableStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { CreateOrderInput } from "@/lib/validations/orders";

/** GST. One constant, because it appears in the total AND in every report of it. */
const TAX_RATE = new Prisma.Decimal("0.05");

export class OrderError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "OrderError";
  }
}

const D = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value);

/** What a client needs to render an order: its lines, its table, its customer. */
export const ORDER_INCLUDE = {
  orderItems: { include: { menuItem: { select: { name: true, isVeg: true } } } },
  table: { select: { id: true, number: true, label: true } },
  customer: { select: { id: true, name: true, phone: true } },
} as const;

/**
 * Prisma's defaults (maxWait 2s, timeout 5s) are tuned for a database on the same
 * machine. This one is in Singapore, and every statement inside a transaction pays a
 * round trip.
 *
 * These transactions SERIALISE on purpose — the order counter and the payment lock are
 * the whole point — so a burst of tills queues behind each other by design. With the
 * defaults, a dozen simultaneous orders blew the 5s ceiling and threw P2028: not a slow
 * sale, a FAILED one, in front of a customer. Queuing is correct; timing out is not.
 *
 * But the ceiling must stay UNDER the serverless function's own limit (see maxDuration
 * on the routes). If the transaction can outlive the function that owns it, the lambda
 * is killed mid-transaction, Postgres never sees a COMMIT or ROLLBACK, and the session
 * sits `idle in transaction` STILL HOLDING the Restaurant row lock — blocking every
 * other till in that restaurant until the TCP connection dies. The database must give up
 * before the platform does.
 *
 * Back this up at the database too, so an abandoned transaction cannot hold locks
 * indefinitely no matter what the app does:
 *
 *   ALTER ROLE neondb_owner SET idle_in_transaction_session_timeout = '15s';
 */
export const TX_OPTIONS = { maxWait: 8_000, timeout: 12_000 } as const;

/**
 * Places an order.
 *
 * Two things here are not negotiable:
 *
 * 1. PRICES COME FROM THE MENU, NOT THE REQUEST. The client sends only what and how
 *    many. A body-supplied `unitPrice` is how a ₹480 curry gets ordered for ₹1, and no
 *    amount of validation on a number the attacker chose can fix that. The price is read
 *    inside the transaction and SNAPSHOT onto the line, so a later price change does not
 *    silently rewrite the value of orders already taken.
 *
 * 2. THE ORDER NUMBER IS MINTED BY AN ATOMIC COUNTER. `SELECT max(...) + 1` races: two
 *    tills read 41 together, both write ORD-0042, and the unique index fails one of them
 *    — a rejected sale in front of a customer. `UPDATE ... SET orderSeq = orderSeq + 1
 *    RETURNING orderSeq` takes a row lock and issues each number exactly once.
 *
 * Money is Decimal throughout. A float would make ₹0.1 + ₹0.2 into ₹0.30000000000000004
 * and the till would be out by a paisa a few times a day, which is worse than being out
 * by a rupee once — nobody notices until the books don't reconcile.
 */
export async function createOrder(restaurantId: string, input: CreateOrderInput) {
  const orderId = await prisma.$transaction(async (tx) => {
    // The menu items, read fresh and tenant-scoped. `isAvailable` is checked here, not
    // in the UI: the client's copy of the menu may be stale, and the kitchen's "we're out
    // of butter chicken" must win over a checkout that started 30 seconds ago.
    const ids = [...new Set(input.items.map((line) => line.menuItemId))];
    const menuItems = await tx.menuItem.findMany({
      where: { id: { in: ids }, restaurantId },
      select: { id: true, name: true, price: true, isAvailable: true },
    });

    const byId = new Map(menuItems.map((item) => [item.id, item]));

    for (const id of ids) {
      const item = byId.get(id);
      // Not found = not ours. A menuItemId from ANOTHER tenant lands here, because the
      // findMany above is tenant-filtered. The composite FK would also refuse it, but
      // this gives an answer instead of a constraint error.
      if (!item) throw new OrderError(422, "That item isn't on this menu.");
      if (!item.isAvailable) {
        throw new OrderError(409, `“${item.name}” is no longer available.`);
      }
    }

    if (input.tableId) {
      // LOCK THE TABLE ROW, not just read it.
      //
      // Table status is DERIVED state ("is a live order sitting here?") maintained by
      // hand across several code paths, and an INSERT into "Order" takes only FOR KEY
      // SHARE on the table — which does NOT conflict with the FOR NO KEY UPDATE that a
      // status change takes. So without this, `payOrder` can COUNT the live orders on a
      // table, miss one that a concurrent createOrder has inserted but not committed,
      // and mark the table AVAILABLE — with a live order sitting on it, permanently.
      //
      // Making the TABLE ROW the serialisation point for table-derived state is what
      // closes it. The table is always the LAST lock taken in every path
      // (create: Restaurant -> Table; pay: Order -> Customer -> Table), so the lock
      // order stays acyclic and cannot deadlock.
      const rows = await tx.$queryRaw<{ status: TableStatus }[]>`
        SELECT status FROM "RestaurantTable"
         WHERE id = ${input.tableId} AND "restaurantId" = ${restaurantId}
         FOR UPDATE`;

      const table = rows[0];
      if (!table) throw new OrderError(422, "That table isn't in this restaurant.");

      // A decommissioned table must not quietly come back into service by being
      // seated — which is exactly what happens if you only check that it exists:
      // INACTIVE -> OCCUPIED on create, and -> AVAILABLE on payment.
      if (table.status === TableStatus.INACTIVE) {
        throw new OrderError(409, "That table is out of service.");
      }
    }

    if (input.customerId) {
      const customer = await tx.customer.count({
        where: { id: input.customerId, restaurantId },
      });
      if (customer === 0) {
        throw new OrderError(422, "That customer isn't in this restaurant.");
      }
    }

    // Totals, computed from the DB's prices.
    let subtotal = D(0);
    const lines = input.items.map((line) => {
      const item = byId.get(line.menuItemId)!;
      const unitPrice = D(item.price);
      const totalPrice = unitPrice.mul(line.quantity);
      subtotal = subtotal.add(totalPrice);
      return { line, unitPrice, totalPrice };
    });

    const discount = D(input.discount);
    if (discount.greaterThan(subtotal)) {
      throw new OrderError(422, "The discount is more than the order is worth.", {
        discount: "Cannot exceed the subtotal",
      });
    }

    const taxable = subtotal.sub(discount);
    const tax = taxable.mul(TAX_RATE).toDecimalPlaces(2);
    const totalAmount = taxable.add(tax).toDecimalPlaces(2);

    // Atomic counter -> the order number. Row lock, no race.
    const bumped = await tx.$queryRaw<{ orderSeq: number }[]>`
      UPDATE "Restaurant" SET "orderSeq" = "orderSeq" + 1
       WHERE id = ${restaurantId}
       RETURNING "orderSeq"`;

    // Destructured defensively: `const [{ orderSeq }] = …` throws a bare TypeError — and
    // therefore a 500 — if the restaurant vanished mid-request.
    const orderSeq = bumped[0]?.orderSeq;
    if (orderSeq === undefined) throw new OrderError(404, "No such restaurant.");

    // The order, then its lines, as two statements in ONE transaction.
    //
    // Not a nested `orderItems: { create }`: a nested write puts Prisma into its CHECKED
    // input mode, where a relation's scalar (restaurantId) may not be set directly and
    // must go through `connect`. Since restaurantId participates in THREE relations here
    // (restaurant, table, customer — the composite tenant FKs), that would mean three
    // compound-key connects to say something very simple. Two plain statements inside the
    // transaction are atomic just the same, and legible.
    const created = await tx.order.create({
      data: {
        restaurantId, // from the URL, never the body
        orderNumber: `ORD-${String(orderSeq).padStart(4, "0")}`,
        type: input.type,
        tableId: input.type === OrderType.DINE_IN ? (input.tableId ?? null) : null,
        customerId: input.customerId ?? null,
        notes: input.notes ?? null,
        status: OrderStatus.PENDING,
        subtotal,
        discount,
        tax,
        totalAmount,
      },
      select: { id: true, tableId: true },
    });

    await tx.orderItem.createMany({
      data: lines.map(({ line, unitPrice, totalPrice }) => ({
        orderId: created.id,
        restaurantId, // composite FK pins this to the order's tenant
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        unitPrice, // SNAPSHOT — a later price change must not rewrite history
        totalPrice,
        notes: line.notes ?? null,
        status: ItemStatus.PENDING,
      })),
    });

    // A table with a live order on it is occupied.
    if (created.tableId) {
      await tx.restaurantTable.update({
        where: { id_restaurantId: { id: created.tableId, restaurantId } },
        data: { status: TableStatus.OCCUPIED },
      });
    }

    // Deliberately NOT the full include here — see the read AFTER the transaction.
    return created.id;
  }, TX_OPTIONS);

  // Read the finished order OUTSIDE the transaction.
  //
  // Every statement inside holds the Restaurant row lock taken by the counter, and every
  // other till placing an order at this moment is queued behind it. This `include` is
  // three joins over a slow link and it needs no lock at all — running it inside cost
  // ~100ms of everyone else's time, and under a burst of concurrent orders that was
  // enough to push the stragglers past the transaction timeout (P2028) and FAIL REAL
  // SALES. Hold the lock for exactly the writes that need it, and not one query more.
  return prisma.order.findUniqueOrThrow({
    where: { id_restaurantId: { id: orderId, restaurantId } },
    include: ORDER_INCLUDE,
  });
}

/**
 * Takes payment — the one place money moves.
 *
 * THE RACE THIS EXISTS TO PREVENT: two tills settle the same bill at the same moment.
 * Both read the order as SERVED, both mark it PAID, and both add its total to the
 * customer's lifetime spend. The customer is charged once but recorded twice, and the
 * CRM the AI reports on is now lying.
 *
 * The fix is a `SELECT ... FOR UPDATE` on the ORDER row, taken first. The second
 * transaction blocks there, and when it finally reads the row it sees PAID and gives up.
 * Read-then-write without the lock is not "unlikely to collide" — it is a lost update
 * waiting for a busy Friday.
 *
 * The customer row is locked too, for the same reason: two DIFFERENT orders paid at once
 * by the same regular would both read the same `totalSpend` and one increment would
 * vanish.
 *
 * Lock order is always Order -> Customer. Two transactions taking the same locks in the
 * same order cannot deadlock; taking them in opposite orders eventually will.
 */
export async function payOrder(restaurantId: string, orderId: string) {
  await prisma.$transaction(async (tx) => {
    // FOR UPDATE: serialises concurrent settlements of THIS order.
    //
    // NOTE the type: `totalAmount` is declared STRING, not Decimal. A raw query goes
    // through the pg driver, which returns `numeric` as a JS string — Prisma's mapping
    // does not apply. Typing it as Decimal compiles and is a lie: it happens to work here
    // only because `{ increment }` accepts a string. Do arithmetic on it (`.sub()`,
    // `.plus()`) and you get a runtime TypeError. Inventory is about to read a locked
    // balance and subtract from it, so normalise at the boundary, every time.
    const locked = await tx.$queryRaw<
      {
        id: string;
        status: OrderStatus;
        totalAmount: string;
        customerId: string | null;
        tableId: string | null;
      }[]
    >`
      SELECT id, status, "totalAmount", "customerId", "tableId"
        FROM "Order"
       WHERE id = ${orderId} AND "restaurantId" = ${restaurantId}
       FOR UPDATE`;

    const order = locked[0];
    if (!order) throw new OrderError(404, "No such order.");

    const totalAmount = D(order.totalAmount); // string -> Decimal, at the boundary

    if (order.status === OrderStatus.PAID) {
      // The loser of the race lands here — the money was taken once, and it stays taken
      // once. Not an error worth alarming anyone about, but not a silent success either.
      throw new OrderError(409, "This order has already been paid.");
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new OrderError(409, "This order was cancelled.");
    }

    // The food must be out before the bill is settled.
    //
    // Allowing PENDING -> PAID looks harmless and quietly loses orders: paying marks
    // every line SERVED and PAID drops the ticket out of the kitchen's open list. The
    // customer has paid, the system says the food went out, and nobody ever cooked it.
    if (order.status !== OrderStatus.READY && order.status !== OrderStatus.SERVED) {
      throw new OrderError(
        409,
        "The food hasn't gone out yet. Mark the order ready or served, then take payment.",
      );
    }

    const paidAt = new Date();

    await tx.order.update({
      where: { id_restaurantId: { id: orderId, restaurantId } },
      data: { status: OrderStatus.PAID, paidAt },
    });

    // A paid order's lines are, by definition, served.
    await tx.orderItem.updateMany({
      where: { orderId, restaurantId },
      data: { status: ItemStatus.SERVED },
    });

    // The CRM rollup. Also locked — see the note above.
    if (order.customerId) {
      await tx.$queryRaw`
        SELECT id FROM "Customer"
         WHERE id = ${order.customerId} AND "restaurantId" = ${restaurantId}
         FOR UPDATE`;

      await tx.customer.update({
        where: { id_restaurantId: { id: order.customerId, restaurantId } },
        data: {
          totalSpend: { increment: totalAmount }, // Decimal, normalised above
          visitCount: { increment: 1 },
          lastVisitAt: paidAt,
        },
      });
    }

    // The table is free again — unless another live order is sitting on it.
    await releaseTableIfIdle(tx, restaurantId, order.tableId);
  }, TX_OPTIONS);

  // Outside the transaction: this read needs no locks, and holding them across it would
  // make every other till settling a bill wait on our joins.
  return prisma.order.findUniqueOrThrow({
    where: { id_restaurantId: { id: orderId, restaurantId } },
    include: ORDER_INCLUDE,
  });
}

/**
 * Cancelling frees the table. Note it does NOT touch the customer rollup — a cancelled
 * order was never paid, so there is nothing to take back.
 */
export async function releaseTableIfIdle(
  tx: Prisma.TransactionClient,
  restaurantId: string,
  tableId: string | null,
) {
  if (!tableId) return;

  // LOCK FIRST, then count. A bare count-then-update is a PHANTOM READ: a concurrent
  // createOrder can insert a live order onto this table between our count and our
  // update, and we would then mark the table free with someone sitting at it — and it
  // would stay wrong forever, because nothing recomputes it. Locking the table row makes
  // this the serialisation point, so the concurrent create blocks here and its order is
  // visible to whoever counts next.
  await tx.$queryRaw`
    SELECT id FROM "RestaurantTable"
     WHERE id = ${tableId} AND "restaurantId" = ${restaurantId}
     FOR UPDATE`;

  const stillBusy = await tx.order.count({
    where: {
      restaurantId,
      tableId,
      status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
    },
  });

  if (stillBusy > 0) return;

  // Only ever release a table that WE made OCCUPIED. Writing AVAILABLE unconditionally
  // would clear a RESERVED booking and bring an INACTIVE table back into service —
  // neither of which anyone asked for. updateMany, so a no-match is a no-op rather than
  // an error.
  await tx.restaurantTable.updateMany({
    where: { id: tableId, restaurantId, status: TableStatus.OCCUPIED },
    data: { status: TableStatus.AVAILABLE },
  });
}
