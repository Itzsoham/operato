import { MemberRole, Plan } from "@/generated/prisma/enums";
import { ok } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import {
  BILLING_UNAVAILABLE_MESSAGE,
  BillingConfigError,
  getKeyId,
  getProPlanId,
  getRazorpay,
  razorpayErrorDetail,
} from "@/lib/razorpay";

/**
 * Razorpay's customer/subscription creation calls are plain synchronous REST calls —
 * nowhere near the AI or order-service transaction budgets — but this route can make up
 * to three of them in sequence (fetch-existing, create-customer, create-subscription)
 * plus their DB writes, so an explicit ceiling beats the platform default, per this
 * codebase's convention on routes with real external work (see orders/route.ts,
 * ai/query/route.ts).
 */
export const maxDuration = 30;

/**
 * Billing cycles to authorise up front. Razorpay subscriptions require a finite
 * total_count — there is no "forever" plan on this API. 120 monthly cycles (10 years) is
 * the conventional stand-in for "renews indefinitely" on a SaaS plan, renewed well before
 * it would ever lapse in practice.
 */
const TOTAL_BILLING_CYCLES = 120;

/** Remote subscription states worth reusing rather than orphaning with a fresh mandate. */
const REUSABLE_STATUSES = new Set(["created", "authenticated", "pending"]);

/**
 * POST /api/restaurants/[restaurantId]/billing/checkout
 *
 * OWNER only (`requireRole` via `withTenant`'s `roles` option) — this mints a real
 * recurring payment mandate against the restaurant's Razorpay customer, gated tighter
 * than the usual "manager can do most things" bar.
 *
 * No request body: everything this needs comes from the URL param (restaurantId) and the
 * session (the OWNER's own email, for the Razorpay customer record and Checkout.js
 * prefill) — same shape as the `pay` route (orders/[orderId]/pay/route.ts), which also
 * takes no client input because there is nothing for a client to legitimately supply.
 *
 * Returns just enough for the client's Checkout.js integration to open the modal:
 * `subscriptionId` — Checkout opens against `subscription_id`, NOT `order_id`, because
 * this is a recurring plan rather than a one-off order — and the public Key ID.
 *
 * Deliberately does NOT set `plan: PRO`. That is the whole point of rule 4 (see
 * AGENTS.md): this client-facing handler only ever creates a PENDING subscription; only a
 * verified `subscription.activated`/`charged` webhook (see /api/webhooks/razorpay) may
 * flip the plan.
 */
export const POST = withTenant(
  async (_req, { restaurantId, userId }) => {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: {
        id: true,
        name: true,
        plan: true,
        razorpayCustomerId: true,
        razorpaySubscriptionId: true,
      },
    });

    if (restaurant.plan === Plan.PRO) {
      return Response.json(
        { error: "This restaurant is already on the Pro plan." },
        { status: 409 },
      );
    }

    let razorpay;
    let planId: string;
    let keyId: string;
    try {
      razorpay = getRazorpay();
      planId = getProPlanId();
      keyId = getKeyId();
    } catch (error) {
      if (error instanceof BillingConfigError) {
        return Response.json({ error: error.message }, { status: 503 });
      }
      throw error;
    }

    // The OWNER's own Better Auth user record — Razorpay needs a real contact email for
    // the customer record and to prefill Checkout.js.
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    if (restaurant.razorpaySubscriptionId) {
      try {
        const existing = await razorpay.subscriptions.fetch(restaurant.razorpaySubscriptionId);
        if (REUSABLE_STATUSES.has(existing.status)) {
          // Not yet paid for — hand back the SAME subscription rather than minting a
          // second live mandate every time the owner re-opens the upgrade dialog.
          return ok({
            subscriptionId: existing.id,
            keyId,
            restaurantName: restaurant.name,
            contactEmail: owner.email,
          });
        }
        if (existing.status === "active") {
          // Razorpay already considers this live; our own plan flag just hasn't caught up
          // yet (the webhook is likely in flight, or the reconciliation cron hasn't run).
          // Minting ANOTHER subscription here would double-charge the restaurant.
          return Response.json(
            {
              error:
                "A subscription is already active for this restaurant. If the plan hasn't " +
                "updated yet, refresh in a moment.",
            },
            { status: 409 },
          );
        }
        // Terminal (cancelled/halted/completed/expired): fall through, create a fresh one.
      } catch (error) {
        // A stale/invalid stored id must not block a legitimate retry — log and fall
        // through to creating a new subscription.
        console.warn(
          "[billing] checkout: could not fetch existing subscription, creating a new one:",
          razorpayErrorDetail(error),
        );
      }
    }

    let customerId = restaurant.razorpayCustomerId;
    if (!customerId) {
      try {
        const customer = await razorpay.customers.create({
          name: restaurant.name,
          email: owner.email,
          // If a Razorpay customer with this email already exists (a retried checkout, or
          // the same owner email used elsewhere on the platform), reuse it instead of
          // throwing — `fail_existing: 1` is the SDK default and would reject this call.
          //
          // Consequence worth knowing: Razorpay keys customers by EMAIL, and the email here
          // is the OWNER's. One person may own several restaurants (OWNED_RESTAURANT_LIMIT
          // in onboarding/actions.ts), so this legitimately returns the SAME cust_xxx for
          // all of them. That is why Restaurant.razorpayCustomerId is NOT unique — it used
          // to be, and the second restaurant's checkout 500'd on the constraint, forever
          // (the column stayed NULL, so every retry re-ran this same path).
          fail_existing: 0,
        });
        customerId = customer.id;
      } catch (error) {
        console.error("[billing] checkout: customers.create failed:", razorpayErrorDetail(error));
        return Response.json({ error: BILLING_UNAVAILABLE_MESSAGE }, { status: 502 });
      }

      await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { razorpayCustomerId: customerId },
      });
    }

    // NOTE: RazorpaySubscriptionCreateRequestBody has no `customer_id` field — the Node
    // SDK's own types confirm a subscription is NOT linked to a customer at creation time.
    // Razorpay links them automatically once the customer completes the Checkout.js
    // authorisation payment (RazorpaySubscription.customer_id's own doc comment: "populated
    // automatically after the customer completes the authorisation transaction"). The
    // customer record created/reused above exists for our own bookkeeping and Checkout.js's
    // prefill, not because subscriptions.create() accepts it — passing one would be a
    // silently-ignored extra field at best.
    let subscription;
    try {
      subscription = await razorpay.subscriptions.create({
        plan_id: planId,
        customer_notify: 1,
        total_count: TOTAL_BILLING_CYCLES,
        // Load-bearing, not decoration. This is the ONLY way the webhook can find the
        // tenant when the subscription that actually got paid for is not the one stored on
        // the row — see the `notes` fallback in webhooks/razorpay/route.ts. Without it, a
        // subscription created by a concurrent second checkout could be charged monthly
        // while its restaurant never reaches PRO and nothing ever repairs it.
        notes: { restaurantId },
      });
    } catch (error) {
      console.error("[billing] checkout: subscriptions.create failed:", razorpayErrorDetail(error));
      return Response.json({ error: BILLING_UNAVAILABLE_MESSAGE }, { status: 502 });
    }

    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { razorpaySubscriptionId: subscription.id },
    });

    return ok({
      subscriptionId: subscription.id,
      keyId,
      restaurantName: restaurant.name,
      contactEmail: owner.email,
    });
  },
  { roles: [MemberRole.OWNER] },
);
