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

/**
 * THE STAGGERED ENTRANCE.
 *
 * `animate-rise` carries the keyframe, duration and easing from the --animate-rise token;
 * the delay is the half a Tailwind animation shorthand cannot hold, so it is spelled out
 * here off --i and --stagger (60ms Crema, 55 Forno, and so on — the cadence is part of
 * the palette). globals.css zeroes BOTH duration and delay under prefers-reduced-motion,
 * which is why a stagger built this way does not leave a reduced-motion visitor staring
 * at opacity:0 for half a second.
 */
const rise = (i: number) =>
  ({ "--i": i, animationDelay: "calc(var(--i) * var(--stagger))" }) as React.CSSProperties;

/**
 * THE SECTION HEAD — the mockups' "printed menu rule" (crema-dashboard.html §7).
 *
 * An uppercase --t-label eyebrow, a display-face title, and a double hairline that runs
 * out to the right edge. It is what turns a flat stack of cards into a page with chapters,
 * and it costs no data: every word here is already known to the server.
 */
function SectionHead({ id, label, title }: { id: string; label: string; title: string }) {
  return (
    <div className="flex flex-wrap items-end gap-sm">
      <div className="min-w-0">
        <span className="block text-label tracking-label text-muted-foreground uppercase">
          {label}
        </span>
        <h2 id={id} className="mt-1.5 font-heading text-h1 text-foreground">
          {title}
        </h2>
      </div>
      {/* The double rule: two hairlines with a gap between them, both in --border, so it
          re-forms as Crema's soft tan, Forno's char, Lievito's ledger grey, Saffron's
          brass. Decorative — aria-hidden, never a separator a screen reader announces. */}
      <div aria-hidden className="mb-2.5 h-0.5 min-w-10 flex-1 border-y border-border" />
    </div>
  );
}

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
  const attributedTotal = overview.attribution.attributed + overview.attribution.anonymous;
  const attributedShare =
    attributedTotal > 0 ? overview.attribution.attributed / attributedTotal : 0;
  const attributedPercent = Math.round(attributedShare * 100);

  return (
    <>
      <PageHeader title="Overview" description={membership.name} />

      <div className="flex flex-1 flex-col gap-lg p-page">
        <section className="flex flex-col gap-lg" aria-labelledby="sec-counter">
          <SectionHead id="sec-counter" label="Rolling 7 days" title="Over the counter" />

          {/* A row of stat tiles, not a grouped bar chart. Four headline numbers with their
              week-on-week change: the number IS the chart.

              The stagger lives on a WRAPPER rather than inside StatTile, so the tile's
              public props stay exactly `{ kpi }` — a visual migration does not get to
              widen a component's contract. h-full on the wrapper plus h-full on the tile
              keeps every card in the row ruling at the same height. */}
          <div className="grid gap sm:grid-cols-2 lg:grid-cols-4">
            {overview.kpis.map((kpi, i) => (
              <div key={kpi.label} className="animate-rise h-full" style={rise(i)}>
                <StatTile kpi={kpi} />
              </div>
            ))}
          </div>
        </section>

        {/* Reorder alert — the one thing on this page that needs acting on today. Status
            colour + an icon + a sentence; never colour alone. The wash is --grad-card-warn,
            the gradient every palette declares for exactly this banner. */}
        {reorder.length > 0 ? (
          <Card
            className="animate-rise gap-0 border-warning-border bg-[image:var(--grad-card-warn)] py-0"
            style={rise(0)}
          >
            <CardContent className="p-card">
              <div className="flex flex-wrap items-start gap-sm">
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-md bg-card text-warning-subtle-foreground shadow-xs ring-1 ring-warning-border"
                >
                  <AlertTriangle className="size-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-h2 text-foreground">
                    {reorder.length} item{reorder.length === 1 ? "" : "s"} below the reorder
                    line
                  </h2>
                  <p className="mt-1 max-w-measure text-small text-warning-subtle-foreground">
                    {reorder
                      .slice(0, 3)
                      .map((line) =>
                        line.daysLeft !== null
                          ? `${line.name} (${line.daysLeft}d left)`
                          : line.name,
                      )
                      .join(", ")}
                    {reorder.length > 3 ? `, and ${reorder.length - 3} more` : ""}.
                  </p>
                </div>

                {/* nativeButton={false}: Base UI's Button assumes a real <button> and warns
                    when `render` hands it an anchor. This IS a link — it navigates — so the
                    anchor is right and the flag is how you say so. */}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto bg-card"
                  nativeButton={false}
                  render={
                    <Link href={`/${restaurantId}/inventory`}>
                      <Package className="size-4" />
                      Inventory
                    </Link>
                  }
                />
              </div>

              {/* The lines themselves, on --card so the numbers sit on the surface the
                  ratio was measured against rather than on the warm wash. */}
              <ul className="mt-lg grid gap-xs sm:grid-cols-2 xl:grid-cols-3">
                {reorder.slice(0, 6).map((line, i) => (
                  <li
                    key={line.id}
                    className="animate-rise grid gap-xs rounded-xl border border-warning-border bg-card p-card-sm"
                    style={rise(i + 1)}
                  >
                    <div className="flex items-baseline gap-xs">
                      <span className="min-w-0 flex-1 truncate text-body font-semibold text-foreground">
                        {line.name}
                      </span>
                      <span className="shrink-0 font-num tabular-nums text-foreground">
                        {line.currentStock}
                        <span className="ml-0.5 text-small text-muted-foreground">
                          {line.unit}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-xs text-chip tabular-nums text-muted-foreground">
                      <span>
                        reorder at {line.lowStockThreshold} {line.unit}
                      </span>
                      <span className="text-warning-subtle-foreground">
                        {line.daysLeft !== null ? `${line.daysLeft}d cover` : "not moving"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <section className="flex flex-col gap-lg" aria-labelledby="sec-month">
          <SectionHead
            id="sec-month"
            label="30 complete days to yesterday"
            title="How the month reads"
          />

          <div className="grid gap-lg lg:grid-cols-3">
            <Card className="animate-rise lg:col-span-2" style={rise(0)}>
              <CardHeader>
                <CardTitle>Revenue</CardTitle>
                <CardDescription>Paid orders · 30 complete days to yesterday</CardDescription>
              </CardHeader>
              <CardContent>
                {/* One series -> no legend. The title says what is plotted. */}
                <RevenueTrend data={overview.trend} />
              </CardContent>
            </Card>

            <Card className="animate-rise" style={rise(1)}>
              <CardHeader>
                <CardTitle>How people order</CardTitle>
                <CardDescription>
                  Share of paid orders · 30 complete days to yesterday
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OrderTypeMix data={overview.typeMix} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-lg lg:grid-cols-3">
            <Card className="animate-rise lg:col-span-2" style={rise(2)}>
              <CardHeader>
                <CardTitle>Top sellers</CardTitle>
                <CardDescription>Units sold · 30 complete days to yesterday</CardDescription>
              </CardHeader>
              <CardContent>
                <TopItems data={overview.topItems} />
              </CardContent>
            </Card>

            <Card className="animate-rise" style={rise(3)}>
              <CardHeader>
                <CardTitle>Known customers</CardTitle>
                <CardDescription>
                  Share of revenue · 30 complete days to yesterday
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-sm">
                <span className="font-num text-metric tabular-nums text-foreground">
                  {attributedPercent}%
                </span>

                {/* A single ratio against a whole -> a meter, not a two-slice pie. The
                    hairline rung, the same one the KPI tiles use — rounded-hair is the
                    system's ONLY hard radius and it exists for exactly these bars. */}
                <div
                  className="h-1 w-full overflow-hidden rounded-hair bg-muted"
                  role="img"
                  aria-label={`${attributedPercent} percent of revenue is attributed to a known customer`}
                >
                  <div
                    className="h-full rounded-hair bg-chart-1"
                    style={{ width: `${attributedShare * 100}%` }}
                  />
                </div>

                <div className="flex items-center justify-between gap-xs text-chip tabular-nums text-muted-foreground">
                  <span>{inr.format(overview.attribution.attributed)} attributed</span>
                  <span>{inr.format(attributedTotal)} taken</span>
                </div>

                <p className="max-w-measure text-small text-balance text-muted-foreground">
                  {inr.format(overview.attribution.attributed)} of{" "}
                  {inr.format(attributedTotal)} is attached to a phone number. The rest is
                  real revenue from walk-ins who didn&apos;t leave one — counted here, but
                  not in the CRM.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </>
  );
}
