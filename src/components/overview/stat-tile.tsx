import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { Kpi } from "@/lib/analytics/overview";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const num = new Intl.NumberFormat("en-IN");

/**
 * A single number plus its change. This is a STAT TILE, not a chart — a one-bar bar chart
 * of "revenue this week" would be a chart with nothing to compare.
 *
 * The delta NEVER speaks by colour alone: it ships an arrow (↑ ↓ →) and a signed
 * percentage, so it reads identically to someone who cannot tell green from red, in
 * greyscale print, and under forced-colors. The colour is reinforcement, not the message.
 */
export function StatTile({ kpi }: { kpi: Kpi }) {
  const format = kpi.format === "currency" ? inr.format : num.format;

  // A change FROM zero has no percentage — 0 → 500 is not "+∞%", it is "new". Dividing
  // anyway prints Infinity, and a dashboard that prints Infinity is one nobody trusts.
  const hasBaseline = kpi.previous > 0;
  const change = hasBaseline ? (kpi.value - kpi.previous) / kpi.previous : null;

  // A sub-half-percent wobble is noise, not a trend. Calling it "up" invites someone to
  // explain a rounding error.
  const flat = change !== null && Math.abs(change) < 0.005;
  const up = change !== null && change > 0;

  const Icon = change === null || flat ? ArrowRight : up ? ArrowUp : ArrowDown;
  const tone =
    change === null || flat
      ? "text-muted-foreground"
      : up === kpi.higherIsBetter
        ? "text-[var(--delta-up)]"
        : "text-[var(--delta-down)]";

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-muted-foreground text-sm font-medium">{kpi.label}</span>

        {/* The value in proportional figures — it stands alone, it isn't a column. */}
        <span className="text-2xl font-semibold">{format(kpi.value)}</span>

        <span className={`flex items-center gap-1 text-xs ${tone}`}>
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="tabular-nums">
            {change === null
              ? "no prior data"
              : flat
                ? "flat"
                : `${up ? "+" : ""}${(change * 100).toFixed(1)}%`}
          </span>
          {/* "the 7 days before that", not "last week" — the window is a rolling 7
              complete days, not a calendar week, and saying otherwise invites someone to
              reconcile this against a Mon–Sun report and find it doesn't match. */}
          {change !== null ? (
            <span className="text-muted-foreground">vs previous 7 days</span>
          ) : null}
        </span>
      </CardContent>
    </Card>
  );
}
