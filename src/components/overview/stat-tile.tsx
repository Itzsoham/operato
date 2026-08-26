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
 * THE CORNER RING — Crema's card ornament, the mark a wet cup leaves on paper.
 *
 * Geometry only: it takes its colour from `currentColor`, so the tile paints it with a
 * token (`text-brand`) and every palette re-cuts it — caramel in Crema, tomato in Forno,
 * ink in Lievito, gold in Saffron. Decorative by declaration: aria-hidden, no pointer
 * events, and it never carries a state.
 */
function CornerRing() {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden
      focusable="false"
      className="pointer-events-none absolute -top-11 -right-11 size-33 text-brand opacity-15"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx="100" cy="100" r="94" strokeWidth="1.4" />
        <circle cx="100" cy="100" r="80" strokeWidth="6" opacity=".45" />
        <circle cx="100" cy="100" r="62" strokeWidth="1.4" />
        <circle cx="100" cy="100" r="44" strokeWidth="3" opacity=".6" />
        <circle cx="100" cy="100" r="25" strokeWidth="1.4" />
      </g>
    </svg>
  );
}

/**
 * A single number plus its change. This is a STAT TILE, not a chart — a one-bar bar chart
 * of "revenue this week" would be a chart with nothing to compare.
 *
 * The FORM is the mockups' `.kpi` (crema-dashboard.html §8): a tall tile with a corner
 * ring, an uppercase --t-label eyebrow, an oversized --text-metric figure in --font-num,
 * the delta line, and a FOOT rule beneath which a hairline meter and its two end-labels
 * put the figure in proportion. Nothing here is a literal: the padding is --pad-card, the
 * radius the card rung, the type steps are text-label / text-metric / text-small /
 * text-chip, so a palette switch actually re-forms the tile instead of only re-colouring
 * it.
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
  // text-delta-up / text-delta-down are real aliases now (--color-delta-* in @theme), so
  // this no longer has to reach past Tailwind with text-[var(--delta-up)].
  const tone =
    change === null || flat
      ? "text-muted-foreground"
      : up === kpi.higherIsBetter
        ? "text-delta-up"
        : "text-delta-down";

  // The foot meter reads this week against the taller of the two weeks, so the fill is
  // always a real proportion and never overflows its own track.
  const peak = Math.max(kpi.value, kpi.previous);
  const share = peak > 0 ? kpi.value / peak : 0;

  return (
    <Card className="relative h-full min-h-52 gap-0 overflow-hidden py-0">
      <CornerRing />

      <CardContent className="flex flex-1 flex-col gap-xs p-card">
        {/* pr-14 keeps the eyebrow clear of the ring, exactly as `.kpi .label` does. */}
        <span className="pr-14 text-label tracking-label text-muted-foreground uppercase">
          {kpi.label}
        </span>

        {/* The value in the numeric face, tabular — it is money or a count, and it sits
            above a meter it has to line up with. */}
        <span className="font-num text-metric tabular-nums text-foreground">
          {format(kpi.value)}
        </span>

        <span className={`flex flex-wrap items-center gap-1 text-small font-semibold ${tone}`}>
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
            <span className="font-normal text-muted-foreground">vs previous 7 days</span>
          ) : null}
        </span>

        {/* THE FOOT — pushed to the bottom by mt-auto so every tile in the row rules at
            the same height however long its figure is. */}
        <div className="mt-auto border-t border-border pt-sm">
          <span className="mb-sm block text-label tracking-label text-muted-foreground uppercase">
            Against the week before
          </span>

          {/* The hairline meter: rounded-hair is the ONLY hard radius in the system, and
              it is what the meter bars are for. role="img" + a sentence, because a bar
              with no label is a decoration. */}
          <div
            className="h-1 w-full overflow-hidden rounded-hair bg-muted"
            role="img"
            aria-label={`${format(kpi.value)} this week against ${format(kpi.previous)} the week before`}
          >
            <div
              className="h-full rounded-hair bg-brand"
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </div>

          <div className="mt-xs flex items-center justify-between gap-xs text-chip tabular-nums text-muted-foreground">
            <span>{format(kpi.previous)} before</span>
            <span>{format(kpi.value)} now</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
