import { OrderStatus } from "@/generated/prisma/enums";
import { created, escapeLike, invalid, ok, parseJson } from "@/lib/api";
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

export const GET = withTenant(async (req, { restaurantId }) => {
  const url = new URL(req.url);
  const parsed = listOrdersSchema.safeParse({
    status: url.searchParams.get("status"),
    open: url.searchParams.get("open"),
    search: url.searchParams.get("search"),
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { status, open, search, limit } = parsed.data;

  const orders = await prisma.order.findMany({
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
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      orderItems: { include: { menuItem: { select: { name: true, isVeg: true } } } },
      table: { select: { id: true, number: true, label: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  return ok(orders);
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
