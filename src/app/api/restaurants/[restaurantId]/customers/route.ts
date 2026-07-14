import { created, escapeLike, invalid, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isUniqueViolation } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { createCustomerSchema, listCustomersSchema } from "@/lib/validations/customers";

export const GET = withTenant(async (req, { restaurantId }) => {
  const url = new URL(req.url);
  const parsed = listCustomersSchema.safeParse({
    search: url.searchParams.get("search"),
    sort: url.searchParams.get("sort") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { search, sort, limit } = parsed.data;
  const term = search ? escapeLike(search) : null;
  // Phones are stored canonical (+919876543210). Search the DIGITS the user typed, so
  // "98765 43210" finds them — otherwise the box can't match its own stored format.
  const digits = search ? escapeLike(search.replace(/\D/g, "")) : "";

  const customers = await prisma.customer.findMany({
    where: {
      restaurantId, // tenant filter first, always
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              ...(digits ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    // Explicit select: `email` is fetched by nobody and rendered by nothing, and shipping
    // a tenant's customer email list to the browser for no reason is how PII leaks.
    select: {
      id: true,
      name: true,
      phone: true,
      totalSpend: true,
      visitCount: true,
      lastVisitAt: true,
      tags: true,
      createdAt: true,
    },
    orderBy:
      sort === "recent"
        ? // NULLS LAST, explicitly. Postgres sorts NULLs FIRST on DESC and Prisma emits no
          // nulls clause — so "most recent visit" opened with the customers who have NEVER
          // visited (lastVisitAt is null until their first paid order). The one sort whose
          // entire job is "who was in recently", topped by people who have never been in.
          [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { name: "asc" }]
        : sort === "name"
          ? [{ name: "asc" }]
          : [{ totalSpend: "desc" }, { name: "asc" }],
    take: limit,
  });

  return ok(customers);
});

/**
 * Creates a customer DELIBERATELY.
 *
 * There is no auto-create anywhere in this codebase, and that is the point. `phone` is
 * required (see the validation), because the schema's @@unique([restaurantId, phone]) is
 * powerless against NULLs — Postgres treats them as distinct — so auto-creating a row for
 * every walk-in would fill the CRM with anonymous duplicates and inflate every figure it
 * reports. An order with no phone carries customerId = null and is still counted in
 * revenue; it just isn't attributed to a person.
 */
export const POST = withTenant(async (req, { restaurantId }) => {
  const parsed = await parseJson(req, createCustomerSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const customer = await prisma.customer.create({
      data: {
        ...parsed.data,
        restaurantId, // from the URL, never the body
        tags: parsed.data.tags ?? [],
        // totalSpend / visitCount / lastVisitAt are NOT settable. They are rolled up from
        // paid orders under a row lock — see src/lib/orders/service.ts.
      },
    });
    return created(customer);
  } catch (error) {
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
