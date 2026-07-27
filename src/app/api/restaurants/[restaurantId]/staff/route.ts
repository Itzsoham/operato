import { MemberRole } from "@/generated/prisma/enums";
import { created, invalid, ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { createStaff, listStaff } from "@/lib/staff/service";
import { createStaffSchema, listStaffSchema } from "@/lib/validations/staff";

// Reading the roster is every member's business (a waiter needs to see who's on shift).
// Hiring, editing pay, and deactivating someone is a manager's decision — the same split
// Menu and Inventory already draw between reading the catalogue and changing it.
const MANAGES_ROSTER = [MemberRole.OWNER, MemberRole.MANAGER] as const;

export const GET = withTenant(async (req, { restaurantId }) => {
  const url = new URL(req.url);
  const parsed = listStaffSchema.safeParse({
    active: url.searchParams.get("active"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const { active } = parsed.data;
  const activeOnly = active === undefined || active === null ? undefined : active === "true";

  return ok(await listStaff(restaurantId, activeOnly));
});

export const POST = withTenant(
  async (req, { restaurantId }) => {
    const parsed = await parseJson(req, createStaffSchema);
    if (!parsed.ok) return parsed.response;

    const staff = await createStaff(restaurantId, parsed.data);
    return created(staff);
  },
  { roles: MANAGES_ROSTER },
);
