import { MemberRole } from "@/generated/prisma/enums";
import { notFound, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { isNotFound } from "@/lib/db-errors";
import { prisma } from "@/lib/db";
import { deactivateStaff, updateStaff } from "@/lib/staff/service";
import { updateStaffSchema } from "@/lib/validations/staff";

type Params = { staffId: string };

const MANAGES_ROSTER = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const GET = withTenant<Params>(async (_req, { restaurantId, params }) => {
  const staff = await prisma.staff.findFirst({
    where: { id: params.staffId, restaurantId },
  });
  if (!staff) return notFound("No such staff member");
  return ok(staff);
});

/**
 * Edits a staff member's details. `isActive` is settable here too — flipping it back to
 * `true` is how someone gets reactivated, the mirror image of DELETE below.
 */
export const PATCH = withTenant<Params>(
  async (req, { restaurantId, params }) => {
    const parsed = await parseJson(req, updateStaffSchema);
    if (!parsed.ok) return parsed.response;

    try {
      const staff = await updateStaff(restaurantId, params.staffId, parsed.data);
      return ok(staff);
    } catch (error) {
      if (isNotFound(error)) return notFound("No such staff member");
      throw error;
    }
  },
  { roles: MANAGES_ROSTER },
);

/**
 * NOT a hard delete — see src/lib/staff/service.ts for why a CASCADE-deleted `Staff` row
 * would take its entire `Shift` (attendance / hours-worked) history with it. This sets
 * `isActive: false` and returns the updated record, rather than 204, precisely because it
 * isn't a removal: the client still has a row to show, just no longer on the active
 * roster.
 */
export const DELETE = withTenant<Params>(
  async (_req, { restaurantId, params }) => {
    try {
      const staff = await deactivateStaff(restaurantId, params.staffId);
      return ok(staff);
    } catch (error) {
      if (isNotFound(error)) return notFound("No such staff member");
      throw error;
    }
  },
  { roles: MANAGES_ROSTER },
);
