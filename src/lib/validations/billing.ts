import { z } from "zod";

/**
 * The Razorpay subscription webhook envelope — only the pieces this codebase reads.
 * Razorpay's `payload.*` shape differs per event category (subscription, payment,
 * refund, ...); modelling the whole taxonomy would be YAGNI. `payload` and
 * `payload.subscription` are optional so an event this handler doesn't act on (a plain
 * `payment.*` event, say) still safe-parses instead of failing validation — the route
 * acks 200 for those rather than 500ing on a shape it was never meant to understand.
 *
 * Unlike every other schema in this directory, nothing in the browser ever constructs
 * this body — it originates entirely from Razorpay's servers. It lives here anyway, per
 * this codebase's one-schema-per-route-input convention: Zod on every route input, not
 * just the ones a form also validates.
 *
 * There is no schema here for POST /billing/checkout — that route takes no request body.
 * Everything it needs comes from the URL param and the session, same as the `pay` route
 * (see orders/[orderId]/pay/route.ts), which also has nothing for a client to legitimately
 * supply.
 */

export const razorpaySubscriptionEntitySchema = z.object({
  id: z.string(),
  /**
   * PLAIN STRING, not a z.enum of the statuses we know about — and that is deliberate.
   *
   * An enum here fails OPEN, not closed: an entity carrying an unlisted status fails
   * safeParse, and the route's response to a parse failure is to log and ack 200 (retrying
   * cannot fix a shape mismatch). So a `subscription.halted` payload with one unexpected
   * status string would be silently DROPPED and the tenant would keep PRO. The event->plan
   * decision (webhook-events.ts) keys off the EVENT NAME anyway and never reads this
   * field, so the enum bought no correctness in exchange for that risk.
   *
   * Razorpay's own status list is also demonstrably not what the SDK's hand-maintained
   * union says it is: the installed razorpay@2.9.8 ships `subscriptions.pause()`/`resume()`
   * while omitting `paused` from its status union. Treat any list as incomplete.
   */
  status: z.string(),
  /** Unix seconds. Null on a subscription that hasn't started billing yet. */
  current_start: z.number().nullish(),
  /** Unix seconds — the current billing cycle's end. What planExpiresAt is set from. */
  current_end: z.number().nullish(),
  /**
   * Free-form key/value we stamp at creation time (billing/checkout/route.ts passes
   * `notes: { restaurantId }`). It is how the webhook recovers the tenant when the
   * subscription id on file does not match the one that was actually paid for — see the
   * `notes` fallback in webhooks/razorpay/route.ts. Trustworthy for that purpose because
   * only this codebase's own API key could have set it, and the payload carrying it is
   * signature-verified.
   */
  notes: z.object({ restaurantId: z.string().optional() }).loose().optional(),
});

export const razorpayWebhookEventSchema = z.object({
  event: z.string(),
  /**
   * NOT documented as reliably present on every Razorpay webhook envelope — kept only for
   * tracing. It is NOT the idempotency key: the header it mirrors sits outside the HMAC.
   * See ProcessedWebhook.dedupeKey in schema.prisma.
   */
  id: z.string().optional(),
  /**
   * Unix seconds — when RAZORPAY created the event, not when we received it. The ordering
   * guard compares this against Restaurant.planUpdatedAt so a redelivered older event
   * cannot overwrite a newer one.
   */
  created_at: z.number().nullish(),
  payload: z
    .object({
      subscription: z
        .object({
          entity: razorpaySubscriptionEntitySchema,
        })
        .optional(),
    })
    .optional(),
});

export type RazorpaySubscriptionEntity = z.infer<typeof razorpaySubscriptionEntitySchema>;
export type RazorpayWebhookEvent = z.infer<typeof razorpayWebhookEventSchema>;
