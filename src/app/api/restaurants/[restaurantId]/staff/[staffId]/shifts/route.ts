import { created, invalid, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { StaffError, clockIn } from "@/lib/staff/service";
import { clockInSchema, listShiftsSchema } from "@/lib/validations/staff";

type Params = { staffId: string };

export const maxDuration = 30; // must exceed TX_OPTIONS.timeout — see orders/route.ts

/** One staff member's attendance history: when they clocked in, out, and for how long. */
export const GET = withTenant<Params>(async (req, { restaurantId, params }) => {
  const url = new URL(req.url);
  const parsed = listShiftsSchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  const shifts = await prisma.shift.findMany({
    where: { staffId: params.staffId, restaurantId }, // tenant-filtered, always
    orderBy: { startTime: "desc" },
    take: parsed.data.limit,
  });

  return ok(shifts);
});

/**
 * Clocks a staff member in. OPEN to every member, deliberately — the same call the
 * Inventory module makes for a delivery or a waste write-off (see
 * inventory/[itemId]/movements/route.ts): this is the person at the door recording that
 * they arrived, not a management decision that should need a manager standing over them.
 */
export const POST = withTenant<Params>(async (req, { restaurantId, params }) => {
  const parsed = await parseJson(req, clockInSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const shift = await clockIn(restaurantId, params.staffId, parsed.data);
    return created(shift);
  } catch (error) {
    if (error instanceof StaffError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
});
