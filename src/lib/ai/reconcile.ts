import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { serialize } from "@/lib/serialize";

/**
 * Does the CRM still agree with the orders it was rolled up from?
 *
 * `Customer.totalSpend` and `Customer.visitCount` are denormalised copies of a truth that
 * lives in `Order`. payOrder() maintains them correctly — under a row lock, in the same
 * transaction that marks the order PAID — but nothing in the database STOPS a future
 * `customer.update({ totalSpend })` from a settings form, a migration, or an import
 * writing a number that never came from an order. STATUS.md lists exactly that as
 * outstanding debt.
 *
 * The failure is silent and compounding: "top customers by spend" is one of the AI's
 * headline questions, and a drifted rollup makes it confidently wrong. Nothing else in the
 * system would ever notice.
 *
 * THE DEFINITION OF TRUTH, matched to what payOrder actually does:
 *   totalSpend = SUM("totalAmount") over that customer's PAID orders
 *   visitCount = COUNT of those orders
 * Cancelling an order deliberately does NOT touch the rollup, and cancelled orders are
 * excluded here for the same reason — the two must agree or every customer looks drifted.
 *
 * DETECT, DO NOT REPAIR. Silently writing the computed value back would erase the evidence
 * of whatever produced it: if some code path is double-counting, auto-repair turns a
 * reproducible bug into a mystery that quietly reappears every week. Report, then let a
 * human decide.
 */

export type RollupDrift = {
  restaurantId: string;
  customerId: string;
  customerName: string;
  recordedSpend: number;
  actualSpend: number;
  recordedVisits: number;
  actualVisits: number;
};

type DriftRow = {
  restaurantId: string;
  customerId: string;
  customerName: string;
  recordedSpend: Prisma.Decimal;
  actualSpend: Prisma.Decimal;
  recordedVisits: number;
  actualVisits: bigint;
};

/**
 * Every customer whose rollup disagrees with their orders.
 *
 * @param restaurantId Optional. Omit to sweep the whole platform (what the weekly cron
 *   does); pass one to check a single tenant from an admin screen.
 *
 * One query, not a loop: an N+1 over every customer on the platform would be slower than
 * the summaries it runs beside.
 */
export async function findCustomerRollupDrift(restaurantId?: string): Promise<RollupDrift[]> {
  // Explicit null, never undefined. Prisma's raw-query parameter binding does not treat
  // `undefined` as SQL NULL, so the "sweep every tenant" call would bind something the
  // driver has no type for instead of the NULL the predicate below is written against.
  const tenant: string | null = restaurantId ?? null;

  const rows = await prisma.$queryRaw<DriftRow[]>`
    SELECT c."restaurantId"          AS "restaurantId",
           c.id                      AS "customerId",
           c.name                    AS "customerName",
           c."totalSpend"            AS "recordedSpend",
           COALESCE(SUM(o."totalAmount"), 0) AS "actualSpend",
           c."visitCount"            AS "recordedVisits",
           COUNT(o.id)               AS "actualVisits"
      FROM "Customer" c
      -- LEFT JOIN, and every predicate on "Order" lives in the ON clause. In a WHERE they
      -- would discard the null rows and collapse this to an INNER join, hiding the single
      -- most interesting case: a customer with a non-zero totalSpend and NO paid orders
      -- at all.
      LEFT JOIN "Order" o
        ON o."customerId"   = c.id
       AND o."restaurantId" = c."restaurantId"
       AND o.status         = 'PAID'
     WHERE (${tenant}::text IS NULL OR c."restaurantId" = ${tenant}::text)
     GROUP BY c."restaurantId", c.id, c.name, c."totalSpend", c."visitCount"
     -- Exact comparison, deliberately. Both sides are numeric(10,2), so there is no float
     -- fuzz to tolerate; a one-paisa difference is a real bug, not rounding.
    HAVING c."totalSpend"  <> COALESCE(SUM(o."totalAmount"), 0)
        OR c."visitCount"  <> COUNT(o.id)
     ORDER BY c."restaurantId", ABS(c."totalSpend" - COALESCE(SUM(o."totalAmount"), 0)) DESC
     LIMIT 500`;

  // Decimal -> number, BigInt -> number, so the report survives JSON.stringify into a log
  // line or an API response.
  return serialize(
    rows.map((row) => ({
      restaurantId: row.restaurantId,
      customerId: row.customerId,
      customerName: row.customerName,
      recordedSpend: Number(row.recordedSpend),
      actualSpend: Number(row.actualSpend),
      recordedVisits: Number(row.recordedVisits),
      actualVisits: Number(row.actualVisits),
    })),
  );
}
