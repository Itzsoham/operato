import { Package } from "lucide-react";

import { ModulePlaceholder } from "@/components/shell/module-placeholder";
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
  await requirePageMember(restaurantId);

  return (
    <>
      <PageHeader title="Inventory" />
      <ModulePlaceholder
        icon={Package}
        title="Inventory isn't built yet"
        description="Stock levels, movements, and what needs reordering."
      />
    </>
  );
}
