import { MenuClient } from "@/components/menu/menu-client";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageMember } from "@/lib/session";

export default async function MenuPage({
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
      <PageHeader title="Menu" description="Dishes, prices and availability." />
      <MenuClient restaurantId={restaurantId} />
    </>
  );
}
