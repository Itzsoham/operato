import { AlertTriangle, Package } from "lucide-react";
import Link from "next/link";

import { OrderTypeMix, RevenueTrend, TopItems } from "@/components/overview/charts";
import { PageHeader } from "@/components/shell/page-header";
import { StatTile } from "@/components/overview/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOverview } from "@/lib/analytics/overview";
import { prisma } from "@/lib/db";
import { getStockLines } from "@/lib/inventory/service";
import { requirePageMember } from "@/lib/session";

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
  // Every page re-checks membership. The layout does too — belt and braces, because this
  // is the guarantee the whole product rests on.
  const { membership } = await requirePageMember(restaurantId);

  // The tenant's own timezone decides where a "day" starts. On a UTC server,
  // date_trunc('day', NOW()) is 05:30 IST — see the note in the analytics module: it
  // misfiles late-night trade and hides the whole previous business day during close-out.
  const { timezone } = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timezone: true },
  });

  const [overview, stock] = await Promise.all([
    getOverview(restaurantId, timezone),
    getStockLines(restaurantId),
  ]);

  const reorder = stock.filter((line) => line.needsReorder);
  const attributedShare =
    overview.attribution.attributed + overview.attribution.anonymous > 0
      ? overview.attribution.attributed /
        (overview.attribution.attributed + overview.attribution.anonymous)
      : 0;

  return (
    <>
      <PageHeader title="Overview" description={membership.name} />

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* A row of stat tiles, not a grouped bar chart. Four headline numbers with their
            week-on-week change: the number IS the chart. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {overview.kpis.map((kpi) => (
            <StatTile key={kpi.label} kpi={kpi} />
          ))}
        </div>

        {/* Reorder alert — the one thing on this page that needs acting on today. Status
            colour + an icon + a sentence; never colour alone. */}
        {reorder.length > 0 ? (
          <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <AlertTriangle
                className="size-4 shrink-0 text-amber-600 dark:text-amber-500"
                aria-hidden
              />
              <span className="text-sm font-medium">
                {reorder.length} item{reorder.length === 1 ? "" : "s"} below the reorder line
              </span>
              <span className="text-muted-foreground text-sm">
                {reorder
                  .slice(0, 3)
                  .map((line) =>
                    line.daysLeft !== null
                      ? `${line.name} (${line.daysLeft}d left)`
                      : line.name,
                  )
                  .join(", ")}
              </span>
              {/* nativeButton={false}: Base UI's Button assumes a real <button> and warns
                  when `render` hands it an anchor. This IS a link — it navigates — so the
                  anchor is right and the flag is how you say so. */}
              <Button
                size="sm"
                variant="outline"
                className="bg-background ml-auto"
                nativeButton={false}
                render={
                  <Link href={`/${restaurantId}/inventory`}>
                    <Package className="size-4" />
                    Inventory
                  </Link>
                }
              />
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Revenue</CardTitle>
              <CardDescription>Paid orders · 30 complete days to yesterday</CardDescription>
            </CardHeader>
            <CardContent>
              {/* One series -> no legend. The title says what is plotted. */}
              <RevenueTrend data={overview.trend} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">How people order</CardTitle>
              <CardDescription>Share of paid orders · 30 complete days to yesterday</CardDescription>
            </CardHeader>
            <CardContent>
              <OrderTypeMix data={overview.typeMix} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Top sellers</CardTitle>
              <CardDescription>Units sold · 30 complete days to yesterday</CardDescription>
            </CardHeader>
            <CardContent>
              <TopItems data={overview.topItems} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Known customers</CardTitle>
              <CardDescription>Share of revenue · 30 complete days to yesterday</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <span className="text-2xl font-semibold">
                {Math.round(attributedShare * 100)}%
              </span>
              {/* A single ratio against a whole -> a meter, not a two-slice pie. */}
              <div
                className="bg-muted h-2 w-full overflow-hidden rounded-full"
                role="img"
                aria-label={`${Math.round(attributedShare * 100)} percent of revenue is attributed to a known customer`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${attributedShare * 100}%`,
                    backgroundColor: "var(--chart-1)",
                  }}
                />
              </div>
              <p className="text-muted-foreground text-sm text-balance">
                {inr.format(overview.attribution.attributed)} of{" "}
                {inr.format(
                  overview.attribution.attributed + overview.attribution.anonymous,
                )}{" "}
                is attached to a phone number. The rest is real revenue from walk-ins who
                didn&apos;t leave one — counted here, but not in the CRM.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
