import { ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { StaffError, clockOut } from "@/lib/staff/service";
import { clockOutSchema } from "@/lib/validations/staff";

type Params = { staffId: string; shiftId: string };

export const maxDuration = 30; // must exceed TX_OPTIONS.timeout — see orders/route.ts

/**
 * Clocks a shift out. Open to every member, for the same reason clocking in is — see
 * shifts/route.ts. `staffId` in the URL is not re-checked against the shift here: the
 * shift is looked up by `shiftId` + `restaurantId` (tenant-scoped) in the service, which
 * is the only ownership check that matters. A mismatched `staffId` in the path would
 * simply be cosmetic — Next's own routing put it there — so nothing trusts it as an
 * additional authorization boundary.
 */
export const PATCH = withTenant<Params>(async (req, { restaurantId, params }) => {
  const parsed = await parseJson(req, clockOutSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const shift = await clockOut(restaurantId, params.shiftId, parsed.data);
    return ok(shift);
  } catch (error) {
    if (error instanceof StaffError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
});
