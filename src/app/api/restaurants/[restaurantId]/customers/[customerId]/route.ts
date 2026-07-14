import { MemberRole } from "@/generated/prisma/enums";
import { badRequest, noContent, notFound, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isForeignKeyViolation, isNotFound, isUniqueViolation } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { updateCustomerSchema } from "@/lib/validations/customers";

type Params = { customerId: string };

/** One customer, with the orders that explain their lifetime spend. */
export const GET = withTenant<Params>(async (_req, { restaurantId, params }) => {
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, restaurantId },
    include: {
      orders: {
        where: { status: "PAID" }, // the rollup is built from PAID orders only
        orderBy: { paidAt: "desc" },
        take: 20,
        select: {
          id: true,
          orderNumber: true,
          totalAmount: true,
          paidAt: true,
          orderItems: {
            select: { quantity: true, menuItem: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!customer) return notFound("No such customer");
  return ok(customer);
});

/**
 * Edits the customer's DETAILS. Deliberately cannot touch totalSpend, visitCount or
 * lastVisitAt: those are derived from paid orders under a row lock, and a PATCH able to
 * set them would let anyone rewrite a lifetime spend with no order to explain it — the
 * same mistake as setting a stock balance with no movement behind it.
 */
export const PATCH = withTenant<Params>(async (req, { restaurantId, params }) => {
  const parsed = await parseJson(req, updateCustomerSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const customer = await prisma.customer.update({
      where: { id_restaurantId: { id: params.customerId, restaurantId } },
      data: parsed.data,
    });
    return ok(customer);
  } catch (error) {
    if (isNotFound(error)) return notFound("No such customer");
    if (isUniqueViolation(error, "phone")) {
      return Response.json(
        {
          error: "Validation failed",
          fieldErrors: { phone: "You already have a customer with that number." },
        },
        { status: 422 },
      );
    }
    throw error;
  }
});

export const DELETE = withTenant<Params>(
  async (_req, { restaurantId, params }) => {
    try {
      await prisma.customer.delete({
        where: { id_restaurantId: { id: params.customerId, restaurantId } },
      });
    } catch (error) {
      if (isNotFound(error)) return notFound("No such customer");

      // Order(customerId, restaurantId) -> Customer is ON DELETE RESTRICT. A customer who
      // appears in the order history cannot be deleted, for the same reason a sold dish
      // cannot: the orders are the books, and an order pointing at a customer who never
      // existed is a corrupt ledger.
      if (isForeignKeyViolation(error)) {
        return badRequest(
          "This customer appears in past orders, so they can't be deleted.",
        );
      }
      throw error;
    }

    return noContent();
  },
  // Removing a customer record is a management act — it destroys the CRM history that
  // the reports and the AI are built on.
  { roles: [MemberRole.OWNER, MemberRole.MANAGER] },
);
