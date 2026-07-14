import { MemberRole } from "@/generated/prisma/enums";
import { created, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isUniqueViolation } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { createTableSchema } from "@/lib/validations/orders";

// Adding or removing tables is a floor-plan change, not a shift task.
const MANAGES_FLOOR = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const GET = withTenant(async (_req, { restaurantId }) => {
  const tables = await prisma.restaurantTable.findMany({
    where: { restaurantId },
    orderBy: { number: "asc" },
    include: {
      // The live order sitting on this table, if any — that's what the floor grid shows.
      orders: {
        where: { status: { notIn: ["PAID", "CANCELLED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, orderNumber: true, status: true, totalAmount: true },
      },
    },
  });

  return ok(tables);
});

export const POST = withTenant(
  async (req, { restaurantId }) => {
    const parsed = await parseJson(req, createTableSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const table = await prisma.restaurantTable.create({
        data: { ...parsed.data, restaurantId }, // restaurantId from the URL, never the body
      });
      return created(table);
    } catch (error) {
      // @@unique([restaurantId, number]) — two tables cannot share a number.
      if (isUniqueViolation(error, "number")) {
        return Response.json(
          { error: "Validation failed", fieldErrors: { number: "That table number is taken." } },
          { status: 422 },
        );
      }
      throw error;
    }
  },
  { roles: MANAGES_FLOOR },
);
