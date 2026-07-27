import { timingSafeEqual } from "node:crypto";

import { ok } from "@/lib/api";
import { runWeeklySummaries } from "@/lib/ai/weekly-summary";

/**
 * POST /api/cron/weekly-summary (and GET — see below)
 *
 * Not a tenant route: no restaurantId in the URL, no `requireMember`. This is
 * server-to-server, and the shared secret IS the auth, the same way a webhook's signature
 * is — there is no user session to check.
 *
 * Vercel's own Cron scheduler (the thing vercel.json's `crons` entry actually drives)
 * ALWAYS triggers a cron job with a GET request, not a POST, and it automatically attaches
 * `Authorization: Bearer ${CRON_SECRET}` to that request when CRON_SECRET is set on the
 * project. If this route only exported POST, Vercel's own trigger would 405 and the cron
 * would never run — so GET is exported too, sharing the same guard and body, so the route
 * works both as Vercel's actual cron target and as a POST a human or a future queue can hit
 * to trigger the same run manually.
 */

/**
 * Vercel serverless function duration caps differ by plan: Hobby is capped at 60s, Pro
 * defaults to 300s (configurable higher with Fluid Compute). `runWeeklySummaries()`'s own
 * internal time budget (DEFAULT_BUDGET_MS in weekly-summary.ts) is 50s, and the platform
 * must not kill the function before that budget's own deadline check has a chance to run —
 * plus there's the restaurant/recent-summary lookups before the loop and the reconciliation
 * sweep after it, neither of which is gated by that budget. 120s gives ~70s of headroom
 * past the internal budget for that overhead. ASSUMPTION: this runs on a Pro (or higher)
 * plan — 120s exceeds Hobby's 60s ceiling, so if this ever deploys to Hobby,
 * `runWeeklySummaries`'s budgetMs needs lowering well below 60s to compensate (that's a
 * change to src/lib/ai/weekly-summary.ts, out of scope here).
 */
export const maxDuration = 120;

/**
 * Constant-time compare of the Authorization header against the expected bearer token.
 *
 * Fails CLOSED: a missing/unset CRON_SECRET must mean "reject everything", never "allow
 * everything" — so an empty/undefined secret returns false rather than skipping the check.
 * `timingSafeEqual` throws on a length mismatch instead of returning false, so the length
 * check has to happen first; that leaks only the header's length, which is far less
 * sensitive than its content.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (headerBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(headerBuf, expectedBuf);
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // `remaining` (tenants not reached before the time budget ran out — the next
    // invocation picks them up) and `drift` (from the CRM rollup reconciliation sweep) are
    // both surfaced here, not just a bare 200, so a monitoring dashboard or log line can
    // see a partial run instead of assuming every tenant got a summary.
    const report = await runWeeklySummaries();
    return ok({
      ...report,
      // findCustomerRollupDrift() sweeps every tenant and its rows carry a customer NAME —
      // fine for the admin screen it's designed for, not fine landing in this response body
      // and from there into Vercel's function logs, which a security review flagged as a
      // PII-minimization issue: only a CRON_SECRET holder can reach it, but logs outlive
      // the request. Listed explicitly (an allowlist, not a destructure-and-discard) so
      // adding a field to RollupDrift later can't silently widen what a log line carries.
      drift: report.drift.map((d) => ({
        restaurantId: d.restaurantId,
        customerId: d.customerId,
        recordedSpend: d.recordedSpend,
        actualSpend: d.actualSpend,
        recordedVisits: d.recordedVisits,
        actualVisits: d.actualVisits,
      })),
    });
  } catch (error) {
    // No human is waiting on this response — Vercel's cron retry logic and whoever reads
    // the function logs are the audience, so log loudly and keep the body minimal.
    console.error("[cron] weekly-summary run failed", error);
    return Response.json({ error: "weekly-summary run failed" }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
