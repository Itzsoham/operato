import { IndianRupee, Package, Receipt, Users } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePageMember } from "@/lib/session";

// The full Overview — charts, week-on-week movement — lands in step 8. These tiles read
// the real seeded data now so the shell isn't demoed against zeroes.

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const { membership } = await requirePageMember(restaurantId);

  const since = new Date();
  since.setDate(since.getDate() - 30);

  // Every query filtered by restaurantId, which came from the URL and was just checked
  // against this user's memberships — never from the request body.
  const [revenue, orders, customers, lowStock] = await Promise.all([
    prisma.order.aggregate({
      where: { restaurantId, status: "PAID", paidAt: { gte: since } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.order.count({ where: { restaurantId, createdAt: { gte: since } } }),
    prisma.customer.count({ where: { restaurantId } }),
    // "Below the reorder line" can't be expressed as a Prisma where-filter comparing two
    // columns, so it goes to SQL — still explicitly tenant-scoped.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "InventoryItem"
       WHERE "restaurantId" = ${restaurantId}
         AND "currentStock" < "lowStockThreshold"`,
  ]);

  const paidTotal = Number(revenue._sum.totalAmount ?? 0);
  const aov = revenue._count > 0 ? paidTotal / revenue._count : 0;
  const lowStockCount = Number(lowStock[0]?.count ?? 0);

  const tiles = [
    { label: "Revenue (30d)", value: inr.format(paidTotal), icon: IndianRupee },
    { label: "Orders (30d)", value: orders.toLocaleString("en-IN"), icon: Receipt },
    { label: "Average order", value: inr.format(aov), icon: IndianRupee },
    { label: "Customers", value: customers.toLocaleString("en-IN"), icon: Users },
  ];

  return (
    <>
      <PageHeader title="Overview" description={membership.name} />

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Card key={tile.label}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  {tile.label}
                </CardTitle>
                <tile.icon className="text-muted-foreground size-4 shrink-0" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{tile.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Needs reordering
            </CardTitle>
            <Package className="text-muted-foreground size-4 shrink-0" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{lowStockCount}</div>
            <p className="text-muted-foreground text-sm">
              {lowStockCount === 0
                ? "Everything is above its reorder line."
                : `${lowStockCount} item${lowStockCount === 1 ? "" : "s"} below the reorder line.`}
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
