import "server-only";

import { prisma } from "@/lib/db";
import { RateLimitError } from "@/lib/ai/errors";
import { DEFAULT_DAILY_QUERIES_PER_TENANT } from "@/lib/ai/models";

/**
 * Per-tenant throttling for the interactive AI, and the bookkeeping it counts.
 *
 * WHY THE REGULAR CLIENT. Everything here uses `prisma`, the app's read-write client, NOT
 * getAiPrisma(). Writing an audit row and counting it is ordinary application work that our
 * own trusted code wrote — there is nothing to sandbox, and the read-only role could not
 * INSERT anyway. The AI client is only ever for executing MODEL-authored SQL.
 *
 * WHY THIS EXISTS AT ALL (docs/plan-code-review.md Finding 7). Gemini's free tier is
 * metered per Google Cloud PROJECT, not per API key, so every tenant plus the weekly cron
 * draws on one bucket. Without a per-tenant cap, one curious owner clicking through
 * questions on a Monday morning exhausts the day's quota for every other tenant AND for the
 * cron — and the failure is invisible: other tenants just get errors.
 *
 * ROLLING 24 HOURS, NOT A CALENDAR DAY. Deliberate: a calendar day would need
 * `Restaurant.timezone` and the whole AT TIME ZONE dance, and would hand every tenant a
 * fresh allowance at local midnight — several bursts a day against a shared per-minute
 * limit. Same reasoning as getStockLines()'s rolling velocity window: rolling windows are
 * timezone-agnostic by construction.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The cap, overridable per environment (raise it the moment the key is billed).
 * Falls back to the documented default on anything unparseable — a typo in an env var must
 * not silently disable the limit.
 */
function dailyLimit(): number {
  const raw = process.env.AI_DAILY_QUERY_LIMIT;
  if (!raw) return DEFAULT_DAILY_QUERIES_PER_TENANT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_QUERIES_PER_TENANT;
}

export type RateLimitStatus = {
  used: number;
  limit: number;
  remaining: number;
};

/**
 * Counts this tenant's AI questions in the last rolling 24 hours.
 *
 * Reads the `@@index([restaurantId, createdAt])` on AiQuery, which the schema comment
 * already earmarks for exactly this lookup.
 */
export async function getAiUsage(restaurantId: string): Promise<RateLimitStatus> {
  const limit = dailyLimit();
  const used = await prisma.aiQuery.count({
    where: {
      restaurantId,
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
  });
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Throws if this tenant is out of questions for the day.
 *
 * KNOWN LIMITATION, stated rather than glossed: this is check-then-act, so two requests
 * arriving in the same instant can both read `used = limit - 1` and both proceed. The
 * overshoot is bounded by concurrency, which for one restaurant's dashboard is one or two —
 * acceptable for protecting a quota, and NOT acceptable if this were ever load-bearing for
 * billing. A hard guarantee needs an atomic counter (Redis INCR, or a unique constraint on
 * a per-tenant-per-window row).
 *
 * @throws {RateLimitError} 429.
 */
export async function checkAiRateLimit(restaurantId: string): Promise<RateLimitStatus> {
  const status = await getAiUsage(restaurantId);
  if (status.used >= status.limit) {
    throw new RateLimitError(status.limit, status.used);
  }
  return status;
}

/**
 * Records one exchange. Also what makes the counter above honest.
 *
 * FAILURES ARE RECORDED TOO, and that is the point. If only successes were written, a
 * question that reliably produced bad SQL could be retried forever: every attempt burns
 * two Gemini calls out of the shared project quota while the counter never moves. Writing
 * a row either way means the limit meters ATTEMPTS, which is what the quota actually
 * charges for — and it leaves an audit trail of what the model was asked and what it wrote,
 * which is the first thing anyone will want after an incident.
 *
 * `generatedSQL` is nullable in the schema: it stays null when the model never got as far
 * as producing SQL.
 */
export async function recordAiQuery(input: {
  restaurantId: string;
  userId: string;
  question: string;
  sql: string | null;
  response: string;
}): Promise<void> {
  try {
    await prisma.aiQuery.create({
      data: {
        restaurantId: input.restaurantId,
        userId: input.userId,
        query: input.question,
        generatedSQL: input.sql,
        response: input.response,
      },
    });
  } catch (error) {
    // Bookkeeping must never turn a good answer into a 500. Losing one audit row is worth
    // less than losing the reply the user is already reading — but it does undercount the
    // rate limit, so it is logged loudly rather than swallowed.
    console.error("[ai] failed to record AiQuery — rate limit will undercount", error);
  }
}
