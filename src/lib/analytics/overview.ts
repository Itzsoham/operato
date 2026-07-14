import "server-only";

import { prisma } from "@/lib/db";

/**
 * The Overview's numbers.
 *
 * REVENUE COMES FROM `Order`, NEVER FROM `Customer.totalSpend`.
 *
 * It is tempting to sum the CRM — it is one column and it is already rolled up. It is
 * also WRONG BY A FACTOR OF NEARLY TWO: a paid order with no phone carries
 * customerId = null (see the customers module — auto-creating a customer per walk-in
 * would fill the CRM with anonymous duplicates), so its money is real revenue attributed
 * to nobody. Today that is ~3,300 of ~5,800 paid orders. SUM(totalSpend) is *attributed*
 * revenue, which is a different and much smaller number, and putting it under the word
 * "Revenue" would make the headline figure on the dashboard a lie.
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

export async function getOverview(restaurantId: string): Promise<Overview> {
  // Every query is tenant-filtered. `restaurantId` came from the URL and was checked
  // against this user's memberships before we got here.
  const [totals, trendRows, itemRows, typeRows, newCustomers, attribution] =
    await Promise.all([
      // KPIs: this window and the one before it, in one pass.
      prisma.$queryRaw<
        { window: string; revenue: string | null; orders: bigint }[]
      >`
        SELECT CASE
                 WHEN "paidAt" >= NOW() - make_interval(days => ${WINDOW_DAYS}) THEN 'current'
                 ELSE 'previous'
               END AS window,
               SUM("totalAmount") AS revenue,
               COUNT(*) AS orders
          FROM "Order"
         WHERE "restaurantId" = ${restaurantId}
           AND status = 'PAID'
           AND "paidAt" >= NOW() - make_interval(days => ${WINDOW_DAYS * 2})
         GROUP BY 1`,

      // Daily revenue. generate_series so a day with NO sales is a zero, not a gap —
      // a line that simply skips the quiet Tuesday tells a prettier story than the truth.
      prisma.$queryRaw<{ date: Date; revenue: string | null }[]>`
        SELECT d.day::date AS date,
               COALESCE(SUM(o."totalAmount"), 0) AS revenue
          FROM generate_series(
                 date_trunc('day', NOW() - make_interval(days => ${TREND_DAYS - 1})),
                 date_trunc('day', NOW()),
                 '1 day'
               ) AS d(day)
          LEFT JOIN "Order" o
            ON o."restaurantId" = ${restaurantId}
           AND o.status = 'PAID'
           AND date_trunc('day', o."paidAt") = d.day
         GROUP BY d.day
         ORDER BY d.day ASC`,

      // Top sellers by units. OrderItem carries restaurantId itself (denormalised on
      // purpose), so this needs no join to be tenant-safe.
      prisma.$queryRaw<{ name: string; units: bigint; revenue: string }[]>`
        SELECT mi.name,
               SUM(oi.quantity) AS units,
               SUM(oi."totalPrice") AS revenue
          FROM "OrderItem" oi
          JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
          JOIN "Order" o ON o.id = oi."orderId"
         WHERE oi."restaurantId" = ${restaurantId}
           AND o.status = 'PAID'
           AND o."paidAt" >= NOW() - make_interval(days => ${TREND_DAYS})
         GROUP BY mi.name
         ORDER BY units DESC
         LIMIT 6`,

      prisma.$queryRaw<{ type: string; orders: bigint; revenue: string }[]>`
        SELECT type::text, COUNT(*) AS orders, SUM("totalAmount") AS revenue
          FROM "Order"
         WHERE "restaurantId" = ${restaurantId}
           AND status = 'PAID'
           AND "paidAt" >= NOW() - make_interval(days => ${TREND_DAYS})
         GROUP BY type
         ORDER BY orders DESC`,

      prisma.$queryRaw<{ window: string; count: bigint }[]>`
        SELECT CASE
                 WHEN "createdAt" >= NOW() - make_interval(days => ${WINDOW_DAYS}) THEN 'current'
                 ELSE 'previous'
               END AS window,
               COUNT(*) AS count
          FROM "Customer"
         WHERE "restaurantId" = ${restaurantId}
           AND "createdAt" >= NOW() - make_interval(days => ${WINDOW_DAYS * 2})
         GROUP BY 1`,

      // Attributed vs anonymous revenue — the honest split. See the note at the top.
      prisma.$queryRaw<{ attributed: string | null; anonymous: string | null }[]>`
        SELECT SUM("totalAmount") FILTER (WHERE "customerId" IS NOT NULL) AS attributed,
               SUM("totalAmount") FILTER (WHERE "customerId" IS NULL) AS anonymous
          FROM "Order"
         WHERE "restaurantId" = ${restaurantId}
           AND status = 'PAID'
           AND "paidAt" >= NOW() - make_interval(days => ${TREND_DAYS})`,
    ]);

  // Raw SQL returns `numeric` as a STRING and COUNT() as a BigInt — neither survives
  // JSON.stringify or arithmetic untouched. Normalise at the boundary, every time.
  const num = (v: string | null | undefined) => Number(v ?? 0);

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
      // Guard the divide: a week with no orders is 0, not NaN — and NaN renders as
      // "₹NaN" in the tile, which is how a dashboard loses trust in one glance.
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
    trend: trendRows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      revenue: num(row.revenue),
    })),
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
