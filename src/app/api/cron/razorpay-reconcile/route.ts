import { timingSafeEqual } from "node:crypto";

import { ok } from "@/lib/api";
import { reconcileRazorpaySubscriptions } from "@/lib/billing/reconcile";

/**
 * GET /api/cron/razorpay-reconcile (and POST — see below)
 *
 * The backstop for /api/webhooks/razorpay: for every restaurant with a Razorpay
 * subscription on file, ask Razorpay what is actually true and repair local drift — a
 * webhook that never arrived (this endpoint was down, a redelivery window lapsed, a
 * transient signature-check failure, ...).
 *
 * Not a tenant route: no restaurantId in the URL, no `requireMember`. Server-to-server,
 * the shared CRON_SECRET IS the auth — identical shape to weekly-summary's cron guard,
 * including exporting both GET (what Vercel Cron actually triggers, always via GET with
 * an auto-attached `Authorization: Bearer $CRON_SECRET`) and POST (for a human or a
 * future queue to trigger the same run manually).
 */
export const maxDuration = 60;

/**
 * Constant-time compare of the Authorization header against the expected bearer token.
 * Fails CLOSED: a missing/unset CRON_SECRET must mean "reject everything", never "allow
 * everything". Identical to weekly-summary/route.ts's own `isAuthorized` — see there for
 * the full reasoning on the length check ordering.
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
    // `repaired`/`skipped`/`failed`/`remaining` are all surfaced here, not just a bare
    // 200, so a monitoring dashboard or log line can see exactly what drifted instead of
    // assuming a 200 means every subscription matched.
    const report = await reconcileRazorpaySubscriptions();
    return ok(report);
  } catch (error) {
    // No human is waiting on this response — Vercel's cron retry logic and whoever reads
    // the function logs are the audience, so log loudly and keep the body minimal.
    console.error("[cron] razorpay-reconcile run failed", error);
    return Response.json({ error: "razorpay-reconcile run failed" }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
