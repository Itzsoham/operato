import { StaffClient } from "@/components/staff/staff-client";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageMember } from "@/lib/session";

export default async function StaffPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  // Every page re-checks membership. The layout does too — belt and braces, because
  // this is the guarantee the whole product rests on.
  const { membership } = await requirePageMember(restaurantId);

  // Hiring, editing pay, and deactivating someone is a manager's decision — same split
  // Inventory draws between reading the catalogue and changing it (see MANAGES_ROSTER
  // server-side in the staff routes).
  const canManage = membership.role !== "STAFF";

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who's on the roster, their role, and who's clocked in right now."
      />
      <StaffClient restaurantId={restaurantId} canManage={canManage} />
    </>
  );
}

