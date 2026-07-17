import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * The Overview's numbers.
 *
 * REVENUE COMES FROM `Order`, NEVER FROM `Customer.totalSpend`.
 *
 * It is tempting to sum the CRM — it is one column and it is already rolled up. It is
 * also WRONG BY ALMOST A FACTOR OF TWO: a paid order with no phone carries
 * customerId = null (see the customers module — auto-creating a customer per walk-in
 * would fill the CRM with anonymous duplicates), so its money is real revenue attributed
 * to nobody. Today that is ~57% of paid orders. SUM(totalSpend) is *attributed* revenue,
 * a different and much smaller number, and putting it under the word "Revenue" would make
 * the headline figure on the dashboard a lie.
 */

/**
 * COMPLETE DAYS ONLY, IN THE RESTAURANT'S OWN TIMEZONE.
 *
 * Two separate mistakes live here, and both make the dashboard lie.
 *
 * 1. TODAY IS A PARTIAL DAY. Including it puts a half-finished number beside seven whole
 *    ones: the revenue line crashes to near-zero at its right edge every morning, and
 *    every delta reads catastrophically down (-43%) at 9am and recovers by closing time.
 *    An owner glancing at that sees a business in freefall.
 *
 * 2. "MIDNIGHT" IS NOT UTC MIDNIGHT. `date_trunc('day', NOW())` on a UTC server is
 *    05:30 IST — so for an Indian restaurant every "day" runs 05:30 to 05:30. Measured on
 *    this database: 78 paid orders (₹90,289) fall in the WRONG calendar day, all of them
 *    late-night trade. Worse, between midnight and 05:30 IST — exactly when an owner does
 *    close-out — that bound still points at yesterday's UTC date, so THE ENTIRE PREVIOUS
 *    BUSINESS DAY VANISHES from the trend and every KPI.
 *
 * So every bound below is the tenant's local midnight, converted back to the UTC wall
 * clock that `paidAt` (a timestamp WITHOUT tz, storing UTC) is comparable against.
 * `Restaurant.timezone` exists for exactly this; leaving it unread made it decorative.
 *
 * The AT TIME ZONE dance also stops this depending on the server's TimeZone GUC, which
 * currently happens to be GMT — load-bearing by luck is not load-bearing.
 */
const WINDOW_DAYS = 7;
const TREND_DAYS = 30;

export type Kpi = {
  label: string;
  value: number;
  previous: number;
  format: "currency" | "number";
  /** Higher is better for all of these; kept explicit so the delta's sign has meaning. */
  higherIsBetter: true;
};

export type TrendPoint = { date: string; revenue: number };
export type TopItem = { name: string; units: number; revenue: number };
export type TypeSlice = { type: string; label: string; orders: number; revenue: number };

export type Overview = {
  kpis: Kpi[];
  trend: TrendPoint[];
  topItems: TopItem[];
  typeMix: TypeSlice[];
  /** How much of the revenue is attributed to a known customer. */
  attribution: { attributed: number; anonymous: number };
};

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

/**
 * Raw-query column types.
 *
 * `numeric` arrives as a Prisma **Decimal OBJECT**, not a string — the annotation these
 * files used to carry ("numeric comes back as a string") was simply wrong, and it only
 * looked fine because `Number(decimal)` coerces through valueOf(). Typed as `string`, the
 * next person reasonably calls `.startsWith()` on it and gets a runtime error, or passes
 * it through to a client component and ships a Decimal into JSON.
 *
 * COUNT() genuinely is a BigInt, and JSON.stringify throws on one — so every value here is
 * normalised before it leaves this module.
 */
type Numeric = Prisma.Decimal | null;

const num = (v: Numeric | number | null | undefined) => Number(v ?? 0);

export async function getOverview(
  restaurantId: string,
  /** The tenant's IANA zone — `Restaurant.timezone`, e.g. "Asia/Kolkata". */
  timezone: string,
): Promise<Overview> {
  // Every query is tenant-filtered. `restaurantId` came from the URL and was checked
  // against this user's memberships before we got here.
  const [totals, trendRows, itemRows, typeRows, newCustomers, attribution] =
    await Promise.all([
      // KPIs: this window and the one before it, in one pass.
      prisma.$queryRaw<{ window: string; revenue: Numeric; orders: bigint }[]>`
        WITH bounds AS (
          SELECT date_trunc('day', NOW() AT TIME ZONE ${timezone})
                   AT TIME ZONE ${timezone} AT TIME ZONE 'UTC' AS today
        )
        SELECT CASE
                 WHEN o."paidAt" >= b.today - make_interval(days => ${WINDOW_DAYS})
                   THEN 'current'
                 ELSE 'previous'
               END AS window,
               SUM(o."totalAmount") AS revenue,
               COUNT(*) AS orders
          FROM "Order" o, bounds b
         WHERE o."restaurantId" = ${restaurantId}
           AND o.status = 'PAID'
           -- Seven WHOLE local days against the seven before them. The upper bound is
           -- what excludes today; both are local midnights.
           AND o."paidAt" >= b.today - make_interval(days => ${WINDOW_DAYS * 2})
           AND o."paidAt" < b.today
         GROUP BY 1`,

      // Daily revenue. generate_series so a day with NO sales is a zero, not a gap — a
      // line that silently skips the quiet Tuesday tells a prettier story than the truth.
      prisma.$queryRaw<{ date: string; revenue: Numeric }[]>`
        WITH bounds AS (
          SELECT date_trunc('day', NOW() AT TIME ZONE ${timezone}) AS local_today
        ),
        days AS (
          SELECT generate_series(
                   b.local_today - make_interval(days => ${TREND_DAYS}),
                   b.local_today - make_interval(days => 1),
                   '1 day'
                 ) AS local_day
            FROM bounds b
        )
        SELECT to_char(d.local_day, 'YYYY-MM-DD') AS date,
               COALESCE(SUM(o."totalAmount"), 0) AS revenue
          FROM days d
          -- The tenant filter MUST live in the ON clause, not the WHERE: on a LEFT JOIN a
          -- WHERE predicate against the right-hand table discards the null rows and
          -- collapses this to an INNER join — taking the zero-days with it, which is the
          -- entire reason for generate_series.
          LEFT JOIN "Order" o
            ON o."restaurantId" = ${restaurantId}
           AND o.status = 'PAID'
           -- A half-open range on the RAW column, so the index can be used. Wrapping
           -- paidAt in date_trunc() would make this non-sargable and force a scan of the
           -- tenant's whole PAID history on every dashboard load.
           AND o."paidAt" >= d.local_day AT TIME ZONE ${timezone} AT TIME ZONE 'UTC'
           AND o."paidAt" < (d.local_day + interval '1 day')
                              AT TIME ZONE ${timezone} AT TIME ZONE 'UTC'
         GROUP BY d.local_day
         ORDER BY d.local_day ASC`,

      // Top sellers by units. OrderItem carries restaurantId itself (denormalised on
      // purpose), so the filter is on the leaf table.
      prisma.$queryRaw<{ name: string; units: bigint; revenue: Numeric }[]>`
        WITH bounds AS (
          SELECT date_trunc('day', NOW() AT TIME ZONE ${timezone})
                   AT TIME ZONE ${timezone} AT TIME ZONE 'UTC' AS today
        )
        SELECT mi.name,
               SUM(oi.quantity) AS units,
               SUM(oi."totalPrice") AS revenue
          FROM "OrderItem" oi
          JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
          -- The composite FK already guarantees o and oi share a tenant, so this predicate
          -- is redundant for CORRECTNESS — but the planner cannot know that, and without
          -- it, it seq-scans every tenant's orders. Cost that grows with the platform
          -- rather than the tenant is a bug in waiting.
          JOIN "Order" o
            ON o.id = oi."orderId"
           AND o."restaurantId" = oi."restaurantId"
          CROSS JOIN bounds b
         WHERE oi."restaurantId" = ${restaurantId}
           AND o.status = 'PAID'
           AND o."paidAt" >= b.today - make_interval(days => ${TREND_DAYS})
           AND o."paidAt" < b.today
         -- Group by id, not name: two dishes can share a name, and grouping by name would
         -- merge them AND retroactively relabel history when one is renamed.
         GROUP BY mi.id, mi.name
         -- The name tiebreak keeps equal-selling dishes in a stable order between loads.
         ORDER BY units DESC, mi.name ASC
         LIMIT 6`,

      prisma.$queryRaw<{ type: string; orders: bigint; revenue: Numeric }[]>`
        WITH bounds AS (
          SELECT date_trunc('day', NOW() AT TIME ZONE ${timezone})
                   AT TIME ZONE ${timezone} AT TIME ZONE 'UTC' AS today
        )
        SELECT o.type::text, COUNT(*) AS orders, SUM(o."totalAmount") AS revenue
          FROM "Order" o, bounds b
         WHERE o."restaurantId" = ${restaurantId}
           AND o.status = 'PAID'
           AND o."paidAt" >= b.today - make_interval(days => ${TREND_DAYS})
           AND o."paidAt" < b.today
         GROUP BY o.type
         ORDER BY orders DESC`,

      prisma.$queryRaw<{ window: string; count: bigint }[]>`
        WITH bounds AS (
          SELECT date_trunc('day', NOW() AT TIME ZONE ${timezone})
                   AT TIME ZONE ${timezone} AT TIME ZONE 'UTC' AS today
        )
        SELECT CASE
                 WHEN c."createdAt" >= b.today - make_interval(days => ${WINDOW_DAYS})
                   THEN 'current'
                 ELSE 'previous'
               END AS window,
               COUNT(*) AS count
          FROM "Customer" c, bounds b
         WHERE c."restaurantId" = ${restaurantId}
           AND c."createdAt" >= b.today - make_interval(days => ${WINDOW_DAYS * 2})
           AND c."createdAt" < b.today
         GROUP BY 1`,

      // Attributed vs anonymous revenue — the honest split. See the note at the top.
      prisma.$queryRaw<{ attributed: Numeric; anonymous: Numeric }[]>`
        WITH bounds AS (
          SELECT date_trunc('day', NOW() AT TIME ZONE ${timezone})
                   AT TIME ZONE ${timezone} AT TIME ZONE 'UTC' AS today
        )
        SELECT SUM(o."totalAmount") FILTER (WHERE o."customerId" IS NOT NULL) AS attributed,
               SUM(o."totalAmount") FILTER (WHERE o."customerId" IS NULL) AS anonymous
          FROM "Order" o, bounds b
         WHERE o."restaurantId" = ${restaurantId}
           AND o.status = 'PAID'
           AND o."paidAt" >= b.today - make_interval(days => ${TREND_DAYS})
           AND o."paidAt" < b.today`,
    ]);

  const current = totals.find((row) => row.window === "current");
  const previous = totals.find((row) => row.window === "previous");

  const currentRevenue = num(current?.revenue);
  const previousRevenue = num(previous?.revenue);
  const currentOrders = Number(current?.orders ?? 0);
  const previousOrders = Number(previous?.orders ?? 0);

  const kpis: Kpi[] = [
    {
      label: "Revenue",
      value: currentRevenue,
      previous: previousRevenue,
      format: "currency",
      higherIsBetter: true,
    },
    {
      label: "Orders",
      value: currentOrders,
      previous: previousOrders,
      format: "number",
      higherIsBetter: true,
    },
    {
      label: "Average order",
      // Guard the divide: a week with no orders is 0, not NaN — and NaN renders as "₹NaN"
      // in the tile, which is how a dashboard loses trust in one glance.
      value: currentOrders > 0 ? currentRevenue / currentOrders : 0,
      previous: previousOrders > 0 ? previousRevenue / previousOrders : 0,
      format: "currency",
      higherIsBetter: true,
    },
    {
      label: "New customers",
      value: Number(newCustomers.find((r) => r.window === "current")?.count ?? 0),
      previous: Number(newCustomers.find((r) => r.window === "previous")?.count ?? 0),
      format: "number",
      higherIsBetter: true,
    },
  ];

  return {
    kpis,
    // Already a 'YYYY-MM-DD' string from to_char, in LOCAL days — deliberately not a Date,
    // which the client would re-interpret in the browser's zone and render a day early for
    // anyone west of UTC.
    trend: trendRows.map((row) => ({ date: row.date, revenue: num(row.revenue) })),
    topItems: itemRows.map((row) => ({
      name: row.name,
      units: Number(row.units),
      revenue: num(row.revenue),
    })),
    typeMix: typeRows.map((row) => ({
      type: row.type,
      label: TYPE_LABEL[row.type] ?? row.type,
      orders: Number(row.orders),
      revenue: num(row.revenue),
    })),
    attribution: {
      attributed: num(attribution[0]?.attributed),
      anonymous: num(attribution[0]?.anonymous),
    },
  };
}
