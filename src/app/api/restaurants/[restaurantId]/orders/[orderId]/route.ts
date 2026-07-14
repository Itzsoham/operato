import { MemberRole, OrderStatus } from "@/generated/prisma/enums";
import { badRequest, notFound, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { ORDER_INCLUDE, TX_OPTIONS, releaseTableIfIdle } from "@/lib/orders/service";
import { canTransition, updateOrderStatusSchema } from "@/lib/validations/orders";

type Params = { orderId: string };

export const maxDuration = 30; // must exceed TX_OPTIONS.timeout — see the orders route

export const GET = withTenant<Params>(async (_req, { restaurantId, params }) => {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, restaurantId },
    include: ORDER_INCLUDE,
  });

  if (!order) return notFound("No such order");
  return ok(order);
});

/**
 * Status changes only. The totals are NOT editable here — they were computed by the
 * server from the menu, and a PATCH that could rewrite `totalAmount` would undo the whole
 * point of pricing server-side.
 */
export const PATCH = withTenant<Params>(async (req, { restaurantId, params, role }) => {
  const parsed = await parseJson(req, updateOrderStatusSchema);
  if (!parsed.ok) return parsed.response;

  const next = parsed.data.status;

  // Advancing an order through the kitchen is everyone's job. VOIDING one is not.
  // "Take the cash, cancel the ticket, no sale ever existed" is the oldest fraud in food
  // service, and an unpaid order can be cancelled without a trace. A manager has to do it.
  if (next === OrderStatus.CANCELLED && role === MemberRole.STAFF) {
    return new Response("Forbidden", { status: 403 });
  }

  // PAID is reachable only through /pay, which is where the money and the customer
  // rollup live. A plain PATCH setting PAID would mark a bill settled without ever
  // touching the customer's lifetime spend — the books and the CRM would silently
  // disagree, with no record of why.
  if (next === OrderStatus.PAID) {
    return badRequest("Use the payment endpoint to settle an order.");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Lock the row: two people advancing the same order at once would otherwise both
    // read the old status and both believe their transition was legal.
    const rows = await tx.$queryRaw<{ status: OrderStatus; tableId: string | null }[]>`
      SELECT status, "tableId" FROM "Order"
       WHERE id = ${params.orderId} AND "restaurantId" = ${restaurantId}
       FOR UPDATE`;

    const current = rows[0];
    if (!current) return { error: "notFound" as const };

    if (!canTransition(current.status, next)) {
      return {
        error: "badTransition" as const,
        from: current.status,
      };
    }

    await tx.order.update({
      where: { id_restaurantId: { id: params.orderId, restaurantId } },
      data: {
        status: next,
        ...(next === OrderStatus.SERVED ? { servedAt: new Date() } : {}),
      },
    });

    // A cancelled order releases its table — but only if no OTHER live order is sitting
    // on it. Two parties can share a table across a shift. (This locks the table row;
    // see releaseTableIfIdle for why a bare count would be a phantom read.)
    if (next === OrderStatus.CANCELLED) {
      await releaseTableIfIdle(tx, restaurantId, current.tableId);
    }

    return { error: null };
  }, TX_OPTIONS);

  if (result.error === "notFound") return notFound("No such order");
  if (result.error === "badTransition") {
    return badRequest(
      `An order that is ${result.from.toLowerCase()} cannot become ${next.toLowerCase()}.`,
    );
  }

  // Read the finished order OUTSIDE the transaction. This include is three joins over a
  // slow link and needs no locks — running it inside made every other till touching this
  // order wait on it.
  const order = await prisma.order.findUniqueOrThrow({
    where: { id_restaurantId: { id: params.orderId, restaurantId } },
    include: ORDER_INCLUDE,
  });

  return ok(order);
});
