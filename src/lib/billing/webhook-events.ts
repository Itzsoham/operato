import "server-only";

import { Plan } from "@/generated/prisma/enums";
import type { RazorpaySubscriptionEntity } from "@/lib/validations/billing";

/**
 * Events that mean "the customer is now paying" — set plan: PRO.
 *
 * `subscription.resumed` is here because Razorpay's dashboard can pause a subscription
 * (this codebase never calls `subscriptions.pause()`, but a human can); resuming one puts
 * it back into billing, which is exactly the same outcome as activating it.
 */
export const ACTIVATING_EVENTS: ReadonlySet<string> = new Set([
  "subscription.activated",
  "subscription.charged",
  "subscription.resumed",
]);

/**
 * Events that mean "the subscription is no longer live" — set plan: FREE and clear the
 * expiry, rather than leaving PRO with a now-stale planExpiresAt.
 *
 * `subscription.paused` counts: a paused subscription is not billing, and leaving it on
 * PRO would grant the plan indefinitely for free. The reconciliation cron maps the
 * `paused` STATUS the same way, so the two paths agree.
 */
export const DEACTIVATING_EVENTS: ReadonlySet<string> = new Set([
  "subscription.cancelled",
  "subscription.halted",
  "subscription.completed",
  "subscription.paused",
]);

/**
 * Used only when Razorpay's payload omits `current_end` — defensive; in practice
 * subscription.activated/charged both carry it (it is the current billing cycle's end).
 */
const FALLBACK_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export type PlanUpdate = { plan: Plan; planExpiresAt: Date | null };

/**
 * Pure decision, no I/O: given a webhook event name and the subscription entity it
 * carries, what should Restaurant.plan/planExpiresAt become?
 *
 * Returns `null` for events this handler does not act on — e.g. `subscription.pending`,
 * `subscription.updated`, or anything else not in the two sets above — so the route can
 * ack 200 without touching the database. Kept separate from the route (no Prisma, no
 * Response) so the event -> plan mapping is unit-testable on its own.
 */
export function planUpdateForEvent(
  event: string,
  entity: RazorpaySubscriptionEntity,
): PlanUpdate | null {
  if (ACTIVATING_EVENTS.has(event)) {
    return {
      plan: Plan.PRO,
      planExpiresAt: entity.current_end
        ? new Date(entity.current_end * 1000)
        : new Date(Date.now() + FALLBACK_PERIOD_MS),
    };
  }
  if (DEACTIVATING_EVENTS.has(event)) {
    return { plan: Plan.FREE, planExpiresAt: null };
  }
  return null;
}

/**
 * The same decision from the other direction: what Restaurant.plan should be for a remote
 * Razorpay subscription STATUS, as read by the reconciliation sweep (billing/reconcile.ts).
 *
 * Lives next to `planUpdateForEvent` rather than in reconcile.ts because the two must
 * agree — the webhook path and the repair path deciding differently about the same
 * subscription would make the cron fight the webhook forever. `paused` is the case that
 * proves it: it has to mean FREE in both, or a paused subscription keeps PRO indefinitely
 * (the webhook is dropped, and the sweep skips it as transient on every run).
 *
 * `null` means "ambiguous/transient — don't touch it". `created`/`authenticated`/`pending`
 * describe a subscription that has neither definitively activated nor definitively ended,
 * so repairing against one risks downgrading a restaurant mid-authorisation, or upgrading
 * one that never completed payment. (`pending` in particular is Razorpay's RETRY state:
 * the subscription is still live.) Only `active` and the terminal statuses are unambiguous
 * enough to act on outside a real webhook event.
 */
export function planForStatus(status: string): Plan | null {
  if (status === "active") return Plan.PRO;
  if (
    status === "cancelled" ||
    status === "halted" ||
    status === "completed" ||
    status === "expired" ||
    status === "paused"
  ) {
    return Plan.FREE;
  }
  return null;
}
