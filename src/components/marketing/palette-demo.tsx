"use client";

import { ArrowDown, ArrowUp, Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import {
  PALETTES,
  isPalette,
  usePalette,
  type Palette,
} from "@/components/palette-provider";
import type { OrderStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * THE LANDING PAGE'S CENTREPIECE — and deliberately NOT a fake preview widget.
 *
 * The control below writes the SAME store the app writes: `usePalette().setPalette`
 * stamps <html data-palette> and persists it to localStorage, so a visitor who picks
 * Saffron on the marketing site signs in to a Saffron dashboard. The mode toggle is
 * next-themes, unchanged. Two independent dimensions, both exposed, both real.
 *
 * WHY THE PREVIEW IS BUILT FROM PRODUCT PARTS, NOT MARKETING FURNITURE: a palette
 * switch in this system changes FORM — radii, shadows, type face and weight, card
 * padding — not hue. That is invisible on a page of headings and buttons and obvious
 * on a KPI tile, a chart, a status chip and a menu row. So the preview is a KPI row,
 * a chart, an order list (rendering the app's real OrderStatusBadge) and a menu row
 * with a statutory FSSAI mark.
 *
 * TYPE, AND WHY THE BIG STEPS USE `font:` RATHER THAN `text-display`:
 * every palette ships the display steps as CSS `font` shorthands (--t-display,
 * --t-h1, --t-h2, --t-metric) which carry WEIGHT AND FACE as well as size — Lievito's
 * display is 200, Forno's is 900, Crema's metric is a light 300. The unpacked
 * `--text-*` Tailwind aliases pin one weight for all four palettes, which would make
 * Lievito and Forno render identically. The small steps (`text-body`, `text-small`,
 * `text-label`, `text-chip`, `text-code`) do not vary by weight between palettes, so
 * those use the named utilities.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/* ── Swatches, read from the LIVE cascade ──────────────────────────────────────
   Never copied hexes. Stamping `data-palette` (and `dark`, on the SAME element,
   because `.dark[data-palette=x]` is a compound selector) re-resolves every token
   inside the span to the palette being previewed, in the mode currently on screen.
   That is why `rounded-sm` is enough to preview Lievito's square corners against
   Crema's rounds — the utility emits `var(--r-xs)`, resolved per scope. */
const SWATCH_TOKENS: Record<Palette, readonly string[]> = {
  crema: ["--background", "--sidebar", "--brand", "--ready"],
  forno: ["--background", "--sidebar", "--brand", "--ready"],
  lievito: ["--background", "--sidebar", "--brand", "--ready"],
  // Saffron collapses --ready onto --brand (the one brass rule), and two identical
  // swatches read as a bug rather than as the deliberate collision it is.
  saffron: ["--background", "--sidebar", "--brand", "--warning"],
};

function SwatchStrip({ palette, isDark }: { palette: Palette; isDark: boolean }) {
  return (
    <span
      data-palette={palette}
      className={cn("flex shrink-0 items-center gap-(--gap-xs)", isDark && "dark")}
      aria-hidden="true"
    >
      {SWATCH_TOKENS[palette].map((token) => (
        <span
          key={token}
          className="border-foreground/15 size-5 rounded-sm border"
          style={{ background: `var(${token})` }}
        />
      ))}
    </span>
  );
}

const MODES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/** Must match `defaultTheme` in theme-provider.tsx and DEFAULT_MODE in palette-switcher.tsx. */
const DEFAULT_MODE = "light";

/* ── The preview's data. Fixed, so nothing shifts under the visitor while they
      switch palettes — the only thing that may change is the look. ─────────── */

const KPIS = [
  { label: "Takings today", value: "₹38,420", delta: "+9.2%", up: true },
  { label: "Tickets", value: "186", delta: "+32", up: true },
  { label: "Average ticket", value: "₹207", delta: "−2.1%", up: false },
] as const;

/** Percent-of-peak, 14 complete days plus today. Data, not design values. */
const TREND = [58, 54, 72, 86, 80, 44, 61, 68, 74, 88, 97, 79, 46, 39] as const;

const ORDERS: readonly { id: string; seat: string; note: string; total: number; status: OrderStatus }[] = [
  { id: "o1", seat: "Table 6", note: "2 flat white · 1 bun", total: 520, status: "READY" },
  { id: "o2", seat: "Counter", note: "1 cold brew 300 ml", total: 240, status: "PREPARING" },
  { id: "o3", seat: "Table 2", note: "Filter coffee · croissant", total: 280, status: "PAID" },
];

const MENU_ROWS = [
  { name: "Filter Coffee", meta: "Beverages · 62 sold today", price: 90, veg: true },
  { name: "Almond Croissant", meta: "Bakery · contains egg", price: 190, veg: false },
] as const;

/** The FSSAI mark: a square outline with a filled dot, green for veg and maroon for
 *  non-veg in EVERY palette and EVERY mode. It is a statutory label, not a design
 *  surface — only its corner radius is themed. */
function VegMark({ veg }: { veg: boolean }) {
  return (
    <span
      role="img"
      aria-label={veg ? "Vegetarian" : "Non-vegetarian"}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-xs border-2",
        veg ? "border-veg" : "border-nonveg",
      )}
    >
      <span className={cn("size-1.5 rounded-pill", veg ? "bg-veg" : "bg-nonveg")} />
    </span>
  );
}

function PreviewKpi({
  label,
  value,
  delta,
  up,
}: {
  label: string;
  value: string;
  delta: string;
  up: boolean;
}) {
  const Icon = up ? ArrowUp : ArrowDown;

  return (
    <div className="ring-foreground/10 bg-card flex flex-col gap-(--gap-xs) rounded-2xl p-(--pad-card-sm) shadow-xs ring-1">
      <span className="text-label tracking-label text-muted-foreground uppercase">{label}</span>
      <span className="text-card-foreground [font:var(--t-metric)] tabular-nums">{value}</span>
      {/* Never colour alone: an arrow glyph AND a signed number carry the direction. */}
      <span
        className={cn(
          "text-small flex items-center gap-1",
          up ? "text-delta-up" : "text-delta-down",
        )}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium tabular-nums">{delta}</span>
        <span className="text-muted-foreground">vs last Tue</span>
      </span>
    </div>
  );
}

/** The product preview. Everything in here is themed by tokens, so it re-draws
 *  itself the instant <html data-palette> changes — no props, no re-mount. */
function ProductPreview() {
  return (
    <div
      className="ring-foreground/10 bg-card overflow-hidden rounded-3xl shadow-lg ring-1"
      role="img"
      aria-label="A preview of the Operato dashboard: takings ₹38,420 today, 186 tickets, average ticket ₹207, a fourteen-day takings chart, three live orders and two menu lines. It re-themes as you change palette."
    >
      {/* The rail strip — the one place the sidebar's own wood/char/paper shows on
          this page, and the fastest tell between the four directions. */}
      <div className="border-border/60 bg-[image:var(--grad-sidebar)] text-sidebar-foreground flex items-center gap-(--gap-sm) border-b px-(--pad-card) py-(--gap-sm)">
        <span
          className="bg-[image:var(--grad-brand)] text-brand-foreground grid size-7 shrink-0 place-items-center rounded-md text-chip"
          aria-hidden
        >
          OP
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-body block truncate font-medium">Crema Coffee Roasters</span>
          <span className="text-small text-muted-foreground block truncate">
            Indiranagar, Bengaluru
          </span>
        </span>
        <span className="bg-ready text-ready-foreground text-chip rounded-2xl px-2 py-1 whitespace-nowrap">
          4 on the pass
        </span>
      </div>

      <div className="bg-background flex flex-col gap-(--gap-lg) p-(--pad-card)">
        {/* 1 · the KPI row */}
        <div className="grid gap-(--gap-sm) sm:grid-cols-3">
          {KPIS.map((kpi) => (
            <PreviewKpi key={kpi.label} {...kpi} />
          ))}
        </div>

        {/* 2 · the chart */}
        <div className="ring-foreground/10 bg-card flex flex-col gap-(--gap-sm) rounded-2xl p-(--pad-card-sm) shadow-xs ring-1">
          <div className="flex flex-wrap items-baseline justify-between gap-(--gap-xs)">
            <h4 className="text-card-foreground [font:var(--t-h2)]">Takings, last 14 days</h4>
            <span className="text-small text-muted-foreground tabular-nums">
              {inr.format(1065420)} total
            </span>
          </div>

          <div className="relative h-24">
            {/* Horizontal hairlines only — no vertical grid, no plot border. */}
            <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
              {[0, 1, 2, 3].map((line) => (
                <span key={line} className="bg-chart-grid h-px w-full" />
              ))}
            </div>
            <div className="relative flex h-full items-end gap-1">
              {TREND.map((height, index) => {
                const today = index === TREND.length - 1;
                return (
                  <span
                    key={index}
                    className={cn(
                      "flex-1 rounded-hair",
                      today ? "bg-brand opacity-70" : "bg-chart-1",
                    )}
                    style={{ height: `${height}%` }}
                  />
                );
              })}
            </div>
          </div>

          <div className="text-label tracking-label text-muted-foreground flex items-center justify-between uppercase">
            <span>12 Aug</span>
            <span>Today, still running</span>
          </div>
        </div>

        {/* 3 · the order list */}
        <div className="flex flex-col gap-(--gap-sm)">
          <h4 className="text-card-foreground [font:var(--t-h2)]">On the board</h4>
          <ul className="ring-foreground/10 bg-card divide-border divide-y overflow-hidden rounded-2xl shadow-xs ring-1">
            {ORDERS.map((order) => (
              <li
                key={order.id}
                className="flex flex-wrap items-center gap-(--gap-sm) px-(--pad-card-sm) py-3"
              >
                <span className="min-w-0">
                  <span className="text-body block font-medium">{order.seat}</span>
                  <span className="text-small text-muted-foreground block truncate">
                    {order.note}
                  </span>
                </span>
                <span className="text-body ml-auto font-medium tabular-nums">
                  {inr.format(order.total)}
                </span>
                <OrderStatusBadge status={order.status} />
              </li>
            ))}
          </ul>
        </div>

        {/* 4 · the menu rows, with the statutory mark */}
        <div className="flex flex-col gap-(--gap-sm)">
          <h4 className="text-card-foreground [font:var(--t-h2)]">Selling today</h4>
          <ul className="flex flex-col gap-(--gap-xs)">
            {MENU_ROWS.map((row) => (
              <li
                key={row.name}
                className="bg-muted flex items-center gap-(--gap-sm) rounded-xl px-(--pad-card-sm) py-3"
              >
                <VegMark veg={row.veg} />
                <span className="min-w-0 flex-1">
                  <span className="text-body block truncate font-medium">{row.name}</span>
                  <span className="text-small text-muted-foreground block truncate">
                    {row.meta}
                  </span>
                </span>
                <span className="text-body font-medium tabular-nums">
                  {inr.format(row.price)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function PaletteDemo() {
  const { palette, setPalette, mounted } = usePalette();
  // `theme` for the SELECTED value — "System" must read as chosen when that is what
  // was picked. `resolvedTheme` is what the swatches must preview, because that is
  // what is actually on screen.
  const { theme, setTheme, resolvedTheme } = useTheme();

  // next-themes has no server value, so the first client render must agree with the
  // server. `mounted` comes from the same useSyncExternalStore the palette uses:
  // false during hydration, true immediately after — no setState-in-effect cascade,
  // no mismatched `checked` attribute.
  // The pre-mount value must be the mode that is ACTUALLY applied on a first visit, which
  // is `light` (see theme-provider.tsx) — not `system`. Showing "System" here would check
  // the wrong radio on the landing page's own demo, on the one screen whose entire job is
  // to demonstrate that the control works.
  const selectedMode = mounted ? (theme ?? DEFAULT_MODE) : DEFAULT_MODE;
  const isDark = mounted && resolvedTheme === "dark";
  const current = PALETTES.find((p) => p.key === palette) ?? PALETTES[0];

  return (
    <div className="grid items-start gap-(--gap-lg) lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
      {/* ── THE CONTROL ─────────────────────────────────────────────────────── */}
      <div className="ring-foreground/10 bg-card flex flex-col gap-(--gap-lg) rounded-3xl p-(--pad-card) shadow-md ring-1">
        <fieldset className="flex min-w-0 flex-col gap-(--gap-sm)">
          <legend className="text-label tracking-label text-muted-foreground mb-(--gap-sm) uppercase">
            Choose a look
          </legend>

          {PALETTES.map((option) => {
            const selected = palette === option.key;
            return (
              <label
                key={option.key}
                className={cn(
                  "flex min-h-tap cursor-pointer items-start gap-(--gap-sm) rounded-2xl border p-(--pad-card-sm)",
                  "duration-(--dur) ease-quint transition-colors",
                  "has-[input:focus-visible]:outline-ring has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2",
                  selected
                    ? "border-brand ring-brand bg-card shadow-sm ring-2"
                    : "border-border bg-card hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <input
                  type="radio"
                  name="operato-palette"
                  value={option.key}
                  checked={selected}
                  onChange={(event) => {
                    // Only ever write a key we recognise, so a future rename cannot
                    // stamp a dead value onto <html>.
                    if (isPalette(event.target.value)) setPalette(event.target.value);
                  }}
                  className="sr-only"
                />
                <SwatchStrip palette={option.key} isDark={isDark} />
                <span className="flex min-w-0 flex-1 flex-col gap-(--gap-xs)">
                  <span className="text-body font-medium">{option.name}</span>
                  <span className="text-small text-muted-foreground text-pretty">
                    {option.blurb}
                  </span>
                </span>
                {/* The selected state is carried by a glyph as well as by the ring,
                    so it never depends on colour alone. */}
                <Check
                  aria-hidden
                  className={cn(
                    "text-brand size-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
              </label>
            );
          })}
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-(--gap-sm)">
          <legend className="text-label tracking-label text-muted-foreground mb-(--gap-sm) uppercase">
            Light or dark
          </legend>
          <div className="border-border bg-muted flex gap-(--gap-xs) rounded-2xl border p-1">
            {MODES.map(({ value, label, Icon }) => {
              const selected = selectedMode === value;
              return (
                <label
                  key={value}
                  className={cn(
                    "flex min-h-tap flex-1 cursor-pointer items-center justify-center gap-(--gap-xs) rounded-xl px-2",
                    "text-small duration-(--dur) ease-quint font-medium transition-colors",
                    "has-[input:focus-visible]:outline-ring has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2",
                    selected
                      ? "bg-card text-card-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name="operato-mode"
                    value={value}
                    checked={selected}
                    onChange={() => setTheme(value)}
                    className="sr-only"
                  />
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <p aria-live="polite" className="text-small text-muted-foreground text-pretty">
          Showing <strong className="text-foreground font-medium">{current.name}</strong> in{" "}
          {selectedMode === "system" ? "your system's" : selectedMode} mode. This is the real
          setting — it follows you into the app when you sign in.
        </p>
      </div>

      {/* ── THE PRODUCT ─────────────────────────────────────────────────────── */}
      <ProductPreview />
    </div>
  );
}
