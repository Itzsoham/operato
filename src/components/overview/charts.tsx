"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TopItem, TrendPoint, TypeSlice } from "@/lib/analytics/overview";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** The three validated categorical slots, in FIXED ORDER. Never cycled, never by rank. */
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

function TooltipCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-sm shadow-md">
      {children}
    </div>
  );
}

// ── Revenue trend ────────────────────────────────────────────────────────────

/**
 * ONE series over time -> area, one hue, NO LEGEND.
 *
 * A legend box with a single swatch just restates the title and costs space. The area
 * fill is a ~10% wash, not a saturated block — the line is the data; the fill only says
 * "this is a quantity above a baseline".
 */
export function RevenueTrend({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueWash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Hairline, solid, recessive — never dashed. Horizontal only: vertical rules add
            ink without helping anyone read a value off the y-axis. */}
        <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />

        <XAxis
          dataKey="date"
          tickFormatter={dayLabel}
          tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v: number) => inrCompact.format(v)}
          tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />

        {/* The crosshair + tooltip are the default, not an extra: an SVG chart in a browser
            IS interactive, and the tooltip is what carries the values we deliberately did
            not label on every point. */}
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipCard>
                <div className="text-muted-foreground text-xs">
                  {dayLabel(String(label))}
                </div>
                <div className="font-medium tabular-nums">
                  {inr.format(Number(payload[0].value))}
                </div>
              </TooltipCard>
            ) : null
          }
        />

        <Area
          type="monotone"
          dataKey="revenue"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#revenueWash)"
          // No dot on every point — 30 markers is noise. The hover dot is the affordance.
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Top items ────────────────────────────────────────────────────────────────

/**
 * Magnitude across NOMINAL categories -> horizontal bar, ONE colour for every bar.
 *
 * Deliberately NOT a value-ramp (darker = bigger). Colouring nominal categories by their
 * own magnitude double-encodes the bar's length as its hue: it burns the only free
 * channel on information the chart already shows, and a ramp fails the chroma floor at
 * its light end by construction. Dishes have no natural order — one series, one colour.
 *
 * Horizontal because dish names are long: rotated x-axis labels are a readability tax
 * nobody has to pay.
 */
export function TopItems({ data }: { data: TopItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 44, left: 0, bottom: 4 }}
        barCategoryGap={8}
      >
        <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={132}
        />

        <Tooltip
          cursor={{ fill: "var(--chart-grid)", fillOpacity: 0.4 }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipCard>
                <div className="font-medium">{payload[0].payload.name}</div>
                <div className="text-muted-foreground text-xs tabular-nums">
                  {payload[0].payload.units} sold ·{" "}
                  {inr.format(payload[0].payload.revenue)}
                </div>
              </TooltipCard>
            ) : null
          }
        />

        <Bar
          dataKey="units"
          fill="var(--chart-1)"
          // 4px rounded data-end, square at the baseline.
          radius={[0, 4, 4, 0]}
          maxBarSize={24}
        >
          {/* Direct label at the tip — bars get the value at the end. This is what lets us
              drop the x-axis entirely: the number is on the mark. */}
          <LabelList
            dataKey="units"
            position="right"
            offset={8}
            className="fill-foreground text-xs tabular-nums"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Order type mix ───────────────────────────────────────────────────────────

/**
 * Part-to-whole -> a single STACKED BAR. Not a pie, not a donut.
 *
 * Three segments, three categorical slots in fixed order. Two of those hues (aqua,
 * yellow) fall below 3:1 on the light surface — the validator WARNs, and the relief rule
 * says that obligates visible labels. So every segment carries a direct label AND a
 * legend: identity is never colour-alone here.
 *
 * The 2px gaps between segments are the surface doing the separating — never a stroke
 * around a mark.
 */
export function OrderTypeMix({ data }: { data: TypeSlice[] }) {
  const total = data.reduce((sum, slice) => sum + slice.orders, 0);
  if (total === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">No paid orders yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The stack. A row of divs, not an SVG — it is one bar; Recharts would be ceremony. */}
      <div className="flex h-10 w-full gap-0.5 overflow-hidden">
        {data.map((slice, i) => {
          const share = slice.orders / total;
          const percent = Math.round(share * 100);
          return (
            <div
              key={slice.type}
              className="flex items-center justify-center first:rounded-l-md last:rounded-r-md"
              style={{ width: `${share * 100}%`, backgroundColor: SERIES[i % SERIES.length] }}
              title={`${slice.label}: ${slice.orders} orders`}
            >
              {/* Only label INSIDE when the text actually fits — a clipped label is worse
                  than none. Below the threshold the legend and tooltip carry it. */}
              {percent >= 12 ? (
                <span className="text-xs font-medium text-white tabular-nums">{percent}%</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* The legend is always present for >= 2 series. Text wears TEXT tokens — never the
          series colour; the swatch beside it carries identity. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {data.map((slice, i) => {
          const percent = Math.round((slice.orders / total) * 100);
          return (
            <div key={slice.type} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: SERIES[i % SERIES.length] }}
              />
              <span>{slice.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {percent}% · {inr.format(slice.revenue)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
