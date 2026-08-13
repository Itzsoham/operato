import { BillingClient } from "@/components/billing/billing-client";
import { PageHeader } from "@/components/shell/page-header";
import { prisma } from "@/lib/db";
import { requirePageMember } from "@/lib/session";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  // Every page re-checks membership. The layout does too — belt and braces, because
  // this is the guarantee the whole product rests on.
  const { membership } = await requirePageMember(restaurantId);

  // No GET route for the current plan yet — `Membership` (session.ts) deliberately does
  // NOT carry `plan` (see its own doc comment: that type crosses into the browser, and
  // billing state isn't something every page render should ship). A read-only field off
  // the tenant's own row, fetched the same way every other page here gets its initial
  // data server-side (see customers/page.tsx, staff/page.tsx), is enough — no new API
  // route needed for this.
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { plan: true, planExpiresAt: true },
  });

  // Minting a live Razorpay payment mandate is gated tighter than the usual "manager can
  // do most things" bar — OWNER only, same split the checkout route itself enforces
  // (`roles: [MemberRole.OWNER]` in billing/checkout/route.ts).
  const canManage = membership.role === "OWNER";

  return (
    <>
      <PageHeader title="Billing" description="Your plan, and how to upgrade." />
      <BillingClient
        restaurantId={restaurantId}
        plan={restaurant.plan}
        planExpiresAt={restaurant.planExpiresAt?.toISOString() ?? null}
        canManage={canManage}
      />
    </>
  );
}
