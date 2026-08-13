import "server-only";

import { Plan } from "@/generated/prisma/enums";
import { planForStatus } from "@/lib/billing/webhook-events";
import { prisma } from "@/lib/db";
import { BillingConfigError, getRazorpay, razorpayErrorDetail } from "@/lib/razorpay";

/**
 * The reconciliation sweep: for every restaurant with a Razorpay subscription on file,
 * ask Razorpay what is actually true and repair local drift — the backstop for a webhook
 * that never arrived (this endpoint was down, Razorpay's ~24h retry window lapsed, a
 * signature check failed transiently, ...).
 *
 * Unlike ai/reconcile.ts's CRM rollup drift (detect, don't repair — a human should look at
 * WHY totalSpend and the order history disagree), there is nothing to investigate here:
 * Razorpay's subscription status IS the source of truth this table is trying to mirror,
 * so repairing on sight is the correct behaviour, not a shortcut.
 */

type RepairedOutcome = {
  restaurantId: string;
  subscriptionId: string;
  from: Plan;
  to: Plan;
  remoteStatus: string;
};

type SkippedOutcome = {
  restaurantId: string;
  subscriptionId: string;
  reason: string;
};

export type BillingReconcileReport = {
  checked: number;
  repaired: RepairedOutcome[];
  skipped: SkippedOutcome[];
  failed: { restaurantId: string; subscriptionId: string; error: string }[];
  /** Not reached before the time budget ran out — the next invocation picks these up. */
  remaining: string[];
};

/**
 * Razorpay's documented API rate limits are far more generous than Gemini's shared
 * free-tier quota — the constraint weekly-summary.ts's 7-second throttle exists for. This
 * is simple pacing against a burst of calls across many tenants, not a tight per-minute
 * budget; there is no model-call cost here, only a REST round trip per tenant.
 */
const DEFAULT_DELAY_MS = 200;

/**
 * Mirrors weekly-summary.ts's own voluntary stop-before-the-platform-kills-you budget.
 * Reconciliation is cheap per tenant (one REST call, no model), so this only matters on a
 * platform with many hundreds of paying tenants — comfortably under most maxDuration caps
 * otherwise, but there is no reason not to have the same safety net.
 */
const DEFAULT_BUDGET_MS = 45_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The cron's body. Deliberately not an HTTP handler — the route owns the CRON_SECRET
 * check and its own `maxDuration`; this function is the part that should be
 * unit-testable and callable from a script, same split as runWeeklySummaries().
 */
export async function reconcileRazorpaySubscriptions(
  options: { delayMs?: number; budgetMs?: number } = {},
): Promise<BillingReconcileReport> {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);

  const report: BillingReconcileReport = {
    checked: 0,
    repaired: [],
    skipped: [],
    failed: [],
    remaining: [],
  };

  let razorpay;
  try {
    razorpay = getRazorpay();
  } catch (error) {
    // Not configured — nothing to reconcile against yet. Surfaced in the report rather
    // than thrown, matching weekly-summary's "report, don't 500 the whole run" style; a
    // legitimate pre-launch state, not a crash.
    report.failed.push({
      restaurantId: "*",
      subscriptionId: "*",
      error: error instanceof BillingConfigError ? error.message : String(error),
    });
    return report;
  }

  const restaurants = await prisma.restaurant.findMany({
    where: { razorpaySubscriptionId: { not: null } },
    select: { id: true, plan: true, planExpiresAt: true, razorpaySubscriptionId: true },
    // Stable order, so a run that stops early and a run that resumes agree on the sequence.
    orderBy: { createdAt: "asc" },
  });

  for (let i = 0; i < restaurants.length; i += 1) {
    const restaurant = restaurants[i];
    const subscriptionId = restaurant.razorpaySubscriptionId;
    // Narrows for TS; the `where` filter above already guarantees this at the DB level.
    if (!subscriptionId) continue;

    if (Date.now() >= deadline) {
      report.remaining = restaurants.slice(i).map((r) => r.id);
      break;
    }

    report.checked += 1;
    try {
      const subscription = await razorpay.subscriptions.fetch(subscriptionId);
      const remoteStatus = subscription.status;
      const desired = planForStatus(remoteStatus);

      if (desired === null) {
        report.skipped.push({
          restaurantId: restaurant.id,
          subscriptionId,
          reason: `remote status "${remoteStatus}" is transient; not repairing`,
        });
      } else if (desired !== restaurant.plan) {
        await prisma.restaurant.update({
          where: { id: restaurant.id },
          data: {
            plan: desired,
            planExpiresAt:
              desired === Plan.PRO
                ? subscription.current_end
                  ? new Date(subscription.current_end * 1000)
                  : restaurant.planExpiresAt
                : null,
            // Stamped so the webhook's out-of-order guard treats this repair as the newest
            // decision. Without it, a webhook Razorpay redelivers hours after this sweep
            // corrected the drift would happily undo the correction.
            planUpdatedAt: new Date(),
          },
        });
        report.repaired.push({
          restaurantId: restaurant.id,
          subscriptionId,
          from: restaurant.plan,
          to: desired,
          remoteStatus,
        });
      }
      // else: already agrees — nothing to report beyond `checked`.
    } catch (error) {
      // Full detail is fine in this report: it only ever reaches a CRON_SECRET-authenticated
      // caller and the function logs, never a browser.
      report.failed.push({
        restaurantId: restaurant.id,
        subscriptionId,
        error: razorpayErrorDetail(error),
      });
    }

    if (i < restaurants.length - 1) await sleep(delayMs);
  }

  return report;
}
