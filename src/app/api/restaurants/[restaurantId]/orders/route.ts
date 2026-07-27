import { OrderStatus } from "@/generated/prisma/enums";
import { badRequest, created, escapeLike, invalid, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { OrderError, createOrder } from "@/lib/orders/service";
import { createOrderSchema, listOrdersSchema } from "@/lib/validations/orders";

/**
 * Must EXCEED the transaction ceiling in src/lib/orders/service.ts (12s).
 *
 * Order creation serialises on the tenant's order counter, so a burst of tills queues by
 * design. If the platform kills the function before the database gives up, the
 * transaction is abandoned mid-flight and the row lock it holds strands every other till
 * in the restaurant.
 */
export const maxDuration = 30;

const CLOSED = [OrderStatus.PAID, OrderStatus.CANCELLED];

/**
 * The UTC instant of local midnight for a "YYYY-MM-DD" date, in the restaurant's own
 * timezone. Doing this arithmetic in JS (`new Date("2026-07-01")`) assumes UTC and would
 * reintroduce the exact bug `src/lib/analytics/overview.ts` was written to fix — a filter
 * for "today" would quietly include or exclude hours of trade depending on the server's
 * timezone. Ask Postgres, the same way overview.ts does.
 */
async function localMidnightUtc(dateStr: string, timezone: string): Promise<Date> {
  const [row] = await prisma.$queryRaw<{ bound: Date }[]>`
    SELECT (${dateStr}::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC' AS bound`;
  return row.bound;
}

/** The calendar day after a "YYYY-MM-DD" string — pure date arithmetic, timezone-agnostic. */
function nextDateString(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const GET = withTenant(async (req, { restaurantId }) => {
  const url = new URL(req.url);
  const parsed = listOrdersSchema.safeParse({
    status: url.searchParams.get("status"),
    open: url.searchParams.get("open"),
    search: url.searchParams.get("search"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { status, open, search, from, to, cursor, limit } = parsed.data;

  if (cursor) {
    // Prisma resolves `cursor: { id }` by the bare id, with no `restaurantId` filter of its
    // own — the PAGE it returns is still correctly tenant-filtered by the `where` below, so
    // this was never a cross-tenant data leak, but a member of A passing a real order id
    // from B would make that order's `createdAt` the page's range bound: a foreign order's
    // timestamp, inferable from what comes back. A cursor only ever originates from THIS
    // route's own `nextCursor`, so a legitimate client never has one outside its tenant —
    // verify it belongs here before trusting it as a range bound.
    const owned = await prisma.order.count({ where: { id: cursor, restaurantId } });
    if (!owned) return badRequest("That page no longer exists. Start from the first page.");
  }

  let createdAtFilter: { gte?: Date; lt?: Date } | undefined;
  if (from || to) {
    // One lookup, only when a date filter is actually requested — the hot floor/open-list
    // path (no from/to) never pays for it.
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { timezone: true },
    });
    createdAtFilter = {
      ...(from ? { gte: await localMidnightUtc(from, restaurant.timezone) } : {}),
      // Exclusive upper bound: local midnight of the day AFTER `to`, so the whole of `to`
      // itself is included — a half-open range, same idea as overview.ts's day buckets.
      ...(to ? { lt: await localMidnightUtc(nextDateString(to), restaurant.timezone) } : {}),
    };
  }

  // Fetch one extra row to know whether another page exists, without a separate COUNT.
  const rows = await prisma.order.findMany({
    where: {
      restaurantId, // tenant filter first, always
      ...(status ? { status } : {}),
      ...(open === "true" ? { status: { notIn: CLOSED } } : {}),
      ...(open === "false" ? { status: { in: CLOSED } } : {}),
      // escapeLike — `%` and `_` are LIKE wildcards; unescaped, a search for "%" returns
      // every order and the box lies about what it found. See src/lib/api.ts.
      ...(search
        ? { orderNumber: { contains: escapeLike(search), mode: "insensitive" } }
        : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      orderItems: { include: { menuItem: { select: { name: true, isVeg: true } } } },
      table: { select: { id: true, number: true, label: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  const hasMore = rows.length > limit;
  const orders = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? orders[orders.length - 1].id : null;

  return ok({ orders, nextCursor });
});

export const POST = withTenant(async (req, { restaurantId }) => {
  const parsed = await parseJson(req, createOrderSchema);
  if (!parsed.ok) return parsed.response;

  try {
    // All the interesting work — pricing from the menu, the atomic order number, the
    // table state — lives in the service, in one transaction. See src/lib/orders/service.ts.
    const order = await createOrder(restaurantId, parsed.data);
    return created(order);
  } catch (error) {
    if (error instanceof OrderError) {
      return Response.json(
        { error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) },
        { status: error.status },
      );
    }

    // Belt and braces on @@unique([restaurantId, orderNumber]). The counter should make
    // this unreachable — but if it were ever behind the existing orders (a database whose
    // orderSeq was not backfilled, say), the failure would otherwise be an unhandled 500
    // with a Postgres stack trace, at the till, in front of a customer.
    if (isUniqueViolation(error, "orderNumber")) {
      return Response.json(
        { error: "Couldn't allocate an order number. Try again." },
        { status: 409 },
      );
    }

    // The service CHECKS that the table/customer/menu items belong to this tenant, but a
    // check is not a lock: a customer or table deleted between the check and the INSERT
    // lands here as a raw FK violation. The composite FKs mean nothing WRONG is ever
    // stored — this just turns an ugly 500 into an answer.
    if (isForeignKeyViolation(error)) {
      return Response.json(
        { error: "Something on that order no longer exists. Refresh and try again." },
        { status: 409 },
      );
    }
    throw error;
  }
});
