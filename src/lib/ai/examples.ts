/**
 * Hand-written question -> SQL pairs. THE CURATED HALF of the model's context.
 *
 * Kept in its own file, deliberately, per docs/plan-code-review.md Finding 10: the table
 * and column description in schema-context.ts is derived from the generated Prisma client
 * and is expected to change whenever the schema does. These examples encode judgement —
 * which column means revenue, that a day boundary is local, that `delta` is the one that
 * reconciles — and must survive that regeneration untouched.
 *
 * SIX, not twenty. Finding 12 lists "trim example AI queries from 20+ to the 5-6 that
 * actually demo well" as an explicit scope cut; more examples also mean more tokens on
 * every single call, against a free-tier quota measured in hundreds of requests a day.
 *
 * Each one is also a worked demonstration of a RULE:
 *   - none of them filters on "restaurantId"    (RLS does that; the model has no id)
 *   - none of them uses SELECT *                 (it fails outright on "Customer")
 *   - revenue is always SUM("totalAmount") WHERE status = 'PAID', dated on "paidAt"
 *   - every calendar boundary goes through the tenant's timezone
 *   - stock is aggregated on "delta", never "quantity"
 */

/**
 * Replaced with the tenant's IANA zone when the prompt is assembled.
 *
 * Hard-coding 'Asia/Kolkata' in the examples would be worse than useless: the model copies
 * examples far more faithfully than it follows prose, so a restaurant in Dubai would get
 * Indian day boundaries in every answer while the DATES section politely said otherwise.
 */
export const TZ_TOKEN = "{{TZ}}";

export type SqlExample = { question: string; sql: string };

export const AI_SQL_EXAMPLES: readonly SqlExample[] = [
  {
    question: "How much did we make this week?",
    sql: `WITH bounds AS (
  SELECT date_trunc('day', NOW() AT TIME ZONE '${TZ_TOKEN}')
           AT TIME ZONE '${TZ_TOKEN}' AT TIME ZONE 'UTC' AS today
)
SELECT SUM(o."totalAmount") AS revenue,
       COUNT(*)             AS orders,
       AVG(o."totalAmount") AS average_order
  FROM "Order" o, bounds b
 WHERE o.status = 'PAID'
   AND o."paidAt" >= b.today - interval '7 days'
   AND o."paidAt" <  b.today`,
  },
  {
    question: "What are my top selling dishes this month?",
    sql: `WITH bounds AS (
  SELECT date_trunc('day', NOW() AT TIME ZONE '${TZ_TOKEN}')
           AT TIME ZONE '${TZ_TOKEN}' AT TIME ZONE 'UTC' AS today
)
SELECT mi.name,
       SUM(oi.quantity)     AS units_sold,
       SUM(oi."totalPrice") AS revenue
  FROM "OrderItem" oi
  JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
  JOIN "Order"    o  ON o.id  = oi."orderId"
  CROSS JOIN bounds b
 WHERE o.status = 'PAID'
   AND o."paidAt" >= b.today - interval '30 days'
   AND o."paidAt" <  b.today
 GROUP BY mi.id, mi.name
 ORDER BY units_sold DESC, mi.name ASC
 LIMIT 5`,
  },
  {
    // Teaches the whole velocity idea in one query: what is low AND how fast it drains.
    // -SUM(delta) over outflows only, NOT SUM(quantity) over a type list — a negative
    // ADJUSTMENT is stock that is genuinely gone, and counting only STOCK_OUT/WASTE shows
    // an item bleeding through shrinkage as having zero usage, hence infinite cover.
    question: "What do I need to reorder?",
    sql: `SELECT i.name,
       i.unit,
       i."currentStock",
       i."lowStockThreshold",
       COALESCE(SUM(-t.delta) FILTER (WHERE t.delta < 0), 0) / 28 AS daily_usage
  FROM "InventoryItem" i
  LEFT JOIN "InventoryTransaction" t
    ON t."inventoryItemId" = i.id
   AND t."createdAt" >= NOW() - interval '28 days'
 WHERE i."currentStock" < i."lowStockThreshold"
 GROUP BY i.id, i.name, i.unit, i."currentStock", i."lowStockThreshold"
 ORDER BY i."currentStock" ASC`,
  },
  {
    // Names every column: "Customer" has column-level grants, so SELECT * is a hard
    // permission error rather than a leak.
    question: "Who are my best customers?",
    sql: `SELECT c.name,
       c."totalSpend",
       c."visitCount",
       c."lastVisitAt"
  FROM "Customer" c
 WHERE c."visitCount" > 0
 ORDER BY c."totalSpend" DESC
 LIMIT 10`,
  },
  {
    question: "How do dine-in, takeaway and delivery compare this month?",
    sql: `WITH bounds AS (
  SELECT date_trunc('month', NOW() AT TIME ZONE '${TZ_TOKEN}')
           AT TIME ZONE '${TZ_TOKEN}' AT TIME ZONE 'UTC' AS month_start
)
SELECT o.type::text          AS order_type,
       COUNT(*)              AS orders,
       SUM(o."totalAmount")  AS revenue,
       AVG(o."totalAmount")  AS average_order
  FROM "Order" o, bounds b
 WHERE o.status = 'PAID'
   AND o."paidAt" >= b.month_start
 GROUP BY o.type
 ORDER BY revenue DESC`,
  },
  {
    // The double conversion in the other direction: "paidAt" holds a UTC wall clock, so it
    // is stamped UTC first and only then read in local time. Grouping on the raw column
    // would report an Indian restaurant's dinner rush as happening at lunchtime.
    question: "What time of day are we busiest?",
    sql: `SELECT EXTRACT(HOUR FROM o."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE '${TZ_TOKEN}') AS local_hour,
       COUNT(*)             AS orders,
       SUM(o."totalAmount") AS revenue
  FROM "Order" o
 WHERE o.status = 'PAID'
   AND o."paidAt" >= NOW() - interval '30 days'
 GROUP BY local_hour
 ORDER BY orders DESC`,
  },
];
