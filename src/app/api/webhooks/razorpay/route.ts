import { ACTIVATING_EVENTS, planUpdateForEvent } from "@/lib/billing/webhook-events";
import { isValidWebhookSignature, webhookDedupeKey } from "@/lib/billing/webhook-signature";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { razorpayWebhookEventSchema } from "@/lib/validations/billing";

/**
 * POST /api/webhooks/razorpay
 *
 * NOT a tenant route — no restaurantId in the URL, no `requireMember`. This is
 * server-to-server; the HMAC signature over the raw body IS the auth, the same way
 * CRON_SECRET is the auth on /api/cron/*.
 *
 * Order of operations matters:
 *   1. Read the RAW body (`req.text()`) — the signature is computed over the exact bytes
 *      Razorpay sent. Letting Next (or us) parse JSON first and re-stringifying it is NOT
 *      the same bytes (key order, whitespace), and would make a genuinely valid signature
 *      fail to verify.
 *   2. Verify the signature. Only THEN parse JSON — an attacker-controlled body must never
 *      reach JSON.parse before its signature is checked.
 *   3. Dedupe on a hash of those same raw bytes (ProcessedWebhook.dedupeKey — NOT the
 *      x-razorpay-event-id header, which sits outside the HMAC; see the comment at the
 *      key's construction below), inside the SAME transaction as whatever DB write the
 *      event causes — so a crash partway through does not "eat" the event: the whole
 *      transaction rolls back, the dedupe row is never committed, and Razorpay's retry
 *      reprocesses it cleanly instead of silently skipping it as "already done".
 *
 * The signature check and the dedupe key both live in billing/webhook-signature.ts — pure
 * functions, unit-tested there (including why the SDK's own `validateWebhookSignature` is
 * deliberately not used).
 */
export const maxDuration = 15;

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    // Fails CLOSED, same rule as CRON_SECRET: an unset secret must reject everything, not
    // trust everything. A legitimate "not configured yet" state right now — there is no
    // deployed URL to put in the Razorpay dashboard, so Razorpay isn't sending anything
    // here yet — not a bug.
    console.error("[webhook] razorpay: RAZORPAY_WEBHOOK_SECRET not set; rejecting.");
    return Response.json({ error: "Webhook not configured" }, { status: 400 });
  }

  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  if (!isValidWebhookSignature(rawBody, signature, secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = razorpayWebhookEventSchema.safeParse(json);
  if (!parsed.success) {
    // Signature-valid but a shape this handler doesn't recognise — log for visibility, ack
    // 200 anyway. Razorpay retries non-2xx responses for up to 24h; retrying will never
    // fix a shape mismatch, so answering 400/500 here just spins the webhook for a day for
    // no gain.
    console.warn("[webhook] razorpay: unrecognised payload shape", parsed.error.flatten());
    return Response.json({ ok: true }, { status: 200 });
  }

  const { event, payload } = parsed.data;

  // A hash of the raw SIGNED bytes, not the x-razorpay-event-id header — that header sits
  // outside the HMAC and is therefore replayable. Full reasoning on webhookDedupeKey.
  const dedupeKey = webhookDedupeKey(rawBody);
  // Kept for tracing/support only — never trusted for a decision.
  const providerEventId = req.headers.get("x-razorpay-event-id") ?? parsed.data.id ?? null;

  const entity = payload?.subscription?.entity;
  const update = entity ? planUpdateForEvent(event, entity) : null;
  /**
   * Razorpay's own event time, not ours. Retries can arrive up to ~24h later and out of
   * order, so this is what the staleness check below compares against.
   */
  const eventAt = parsed.data.created_at ? new Date(parsed.data.created_at * 1000) : null;

  try {
    await prisma.$transaction(async (tx) => {
      // Insert-first idempotency: a unique-constraint violation here means "already
      // processed" and is caught below, so nothing after this line runs twice.
      await tx.processedWebhook.create({
        data: { dedupeKey, providerEventId, provider: "razorpay" },
      });

      if (!update || !entity) return; // recorded as seen; nothing this handler acts on

      let restaurant = await tx.restaurant.findUnique({
        where: { razorpaySubscriptionId: entity.id },
        select: { id: true, planUpdatedAt: true },
      });

      // Adopting entity.id onto the row, rather than just reading the row.
      let adopt = false;

      if (!restaurant) {
        // SELF-HEAL. The subscription that got PAID FOR is not always the one on file:
        // two concurrent checkouts both see a null razorpaySubscriptionId, both create
        // (sub_A, sub_B), last write wins — and if the owner then pays in the tab holding
        // the loser, Razorpay starts a recurring monthly mandate for a subscription id
        // this table has never heard of. Without a fallback that is the worst failure mode
        // in the whole flow: charged every month, never upgraded, and invisible to the
        // reconciliation cron (which only iterates ids already stored).
        //
        // `notes.restaurantId` is stamped by billing/checkout/route.ts at creation time. It
        // is safe to trust HERE and only here: notes can only have been set by this
        // codebase's own Razorpay API key, and this payload has already passed the HMAC
        // check above.
        //
        // Restricted to ACTIVATING events on purpose. Those prove *this specific*
        // subscription is the live, paid one, so adopting its id is a genuine correction.
        // A deactivating event proves nothing of the sort — a stale `subscription.cancelled`
        // for the abandoned sub_A would otherwise adopt sub_A back onto the row and
        // downgrade a restaurant that is happily paying on sub_B.
        const notedRestaurantId = entity.notes?.restaurantId;
        if (!notedRestaurantId || !ACTIVATING_EVENTS.has(event)) {
          // Not ours — a stale/test event, or a subscription created outside this flow.
          // Not an error: ack rather than retry-loop on something that will never match.
          console.warn(`[webhook] razorpay: no restaurant for subscription ${entity.id}`, {
            providerEventId,
            event,
          });
          return;
        }

        restaurant = await tx.restaurant.findUnique({
          where: { id: notedRestaurantId },
          select: { id: true, planUpdatedAt: true },
        });
        if (!restaurant) {
          console.warn("[webhook] razorpay: notes.restaurantId matches no restaurant", {
            providerEventId,
            event,
            subscriptionId: entity.id,
          });
          return;
        }
        adopt = true;
        console.warn("[webhook] razorpay: adopting orphaned subscription via notes", {
          restaurantId: restaurant.id,
          subscriptionId: entity.id,
          event,
        });
      }

      // ORDERING GUARD. Razorpay redelivers for ~24h with no ordering guarantee, so a
      // retried subscription.charged can land AFTER a subscription.cancelled and re-grant
      // PRO to someone who cancelled. An event older than the one already applied is
      // recorded as processed (the insert above committed) but changes nothing.
      if (eventAt && restaurant.planUpdatedAt && eventAt < restaurant.planUpdatedAt) {
        console.warn("[webhook] razorpay: ignoring out-of-order event", {
          restaurantId: restaurant.id,
          event,
          eventAt: eventAt.toISOString(),
          lastAppliedAt: restaurant.planUpdatedAt.toISOString(),
        });
        return;
      }

      await tx.restaurant.update({
        where: { id: restaurant.id },
        data: {
          plan: update.plan,
          planExpiresAt: update.planExpiresAt,
          // Falls back to receipt time only when Razorpay omitted created_at, so the guard
          // above still has something to compare against next time.
          planUpdatedAt: eventAt ?? new Date(),
          ...(adopt ? { razorpaySubscriptionId: entity.id } : {}),
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, "dedupeKey")) {
      // Already processed — a Razorpay redelivery or a manual resend from the dashboard.
      // Ack without reprocessing.
      return Response.json({ ok: true, duplicate: true }, { status: 200 });
    }
    console.error("[webhook] razorpay: failed to process event", error);
    return Response.json({ error: "Failed to process webhook" }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
