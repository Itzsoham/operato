import { Users } from "lucide-react";

import { ModulePlaceholder } from "@/components/shell/module-placeholder";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageMember } from "@/lib/session";

export default async function CustomersPage({
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
      <PageHeader title="Customers" />
      <ModulePlaceholder
        icon={Users}
        title="Customers isn't built yet"
        description="Who comes back, what they spend, when they last visited."
      />
    </>
  );
}
