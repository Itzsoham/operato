import { CustomersClient } from "@/components/customers/customers-client";
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
      <PageHeader
        title="Customers"
        description="Who comes back, what they spend, when they last visited."
      />
      <CustomersClient restaurantId={restaurantId} />
    </>
  );
}
