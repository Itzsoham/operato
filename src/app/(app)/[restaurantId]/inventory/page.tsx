import { InventoryClient } from "@/components/inventory/inventory-client";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageMember } from "@/lib/session";

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  // Every page re-checks membership. The layout does too — belt and braces, because
  // this is the guarantee the whole product rests on.
  const { membership } = await requirePageMember(restaurantId);

  // A stock-take is the only unbounded write to the balance, so it is a management act —
  // enforced on the server too (see the movements route); this only hides the option.
  const canAdjust = membership.role !== "STAFF";

  return (
    <>
      <PageHeader title="Inventory" description="Stock, movements, and what to reorder." />
      <InventoryClient restaurantId={restaurantId} canAdjust={canAdjust} />
    </>
  );
}
