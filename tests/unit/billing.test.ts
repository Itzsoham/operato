import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { Plan } from "../../src/generated/prisma/enums";
import {
  ACTIVATING_EVENTS,
  DEACTIVATING_EVENTS,
  planForStatus,
  planUpdateForEvent,
} from "../../src/lib/billing/webhook-events";
import {
  isValidWebhookSignature,
  webhookDedupeKey,
} from "../../src/lib/billing/webhook-signature";
import { razorpayWebhookEventSchema } from "../../src/lib/validations/billing";

/**
 * The billing path decides who gets charged and who keeps a paid plan, and until now the
 * only verification it had was a static read-through. Everything covered here is pure —
 * no Razorpay client, no Prisma, no env — which is exactly why the crypto and the two
 * plan-decision maps were split out of the route and the reconcile sweep.
 *
 * The DB-backed half of idempotency (a duplicate insert on ProcessedWebhook.dedupeKey
 * returning `{ duplicate: true }`) is covered end-to-end in tests/e2e/billing-webhook.spec.ts
 * against a real route and a real Postgres, because that guarantee lives in the unique
 * index, not in any function here.
 */

const SECRET = "test_webhook_secret";
const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

const entity = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_TEST123",
  status: "active",
  current_start: 1_754_000_000,
  current_end: 1_756_600_000,
  ...overrides,
});

describe("isValidWebhookSignature", () => {
  const body = JSON.stringify({ event: "subscription.charged", payload: {} });

  it("accepts the signature Razorpay would have produced", () => {
    expect(isValidWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body tampered with after signing — the whole point", () => {
    const signature = sign(body);
    const tampered = JSON.stringify({ event: "subscription.activated", payload: {} });
    expect(isValidWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(isValidWebhookSignature(body, sign(body, "wrong_secret"), SECRET)).toBe(false);
  });

  it("returns false rather than THROWING on a wrong-length signature", () => {
    // timingSafeEqual throws on a length mismatch. If the length guard is ever removed,
    // this becomes an unhandled 500 on any junk signature instead of a clean 400.
    expect(() => isValidWebhookSignature(body, "short", SECRET)).not.toThrow();
    expect(isValidWebhookSignature(body, "short", SECRET)).toBe(false);
    expect(isValidWebhookSignature(body, "", SECRET)).toBe(false);
    expect(isValidWebhookSignature(body, `${sign(body)}00`, SECRET)).toBe(false);
  });

  it("is byte-exact: whitespace-equivalent JSON does not verify", () => {
    // Why the route must hash req.text() and never JSON.parse -> JSON.stringify.
    const signature = sign(body);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(reserialised).not.toBe(body);
    expect(isValidWebhookSignature(reserialised, signature, SECRET)).toBe(false);
  });
});

describe("webhookDedupeKey", () => {
  it("is stable for a byte-identical redelivery", () => {
    const body = JSON.stringify({ event: "subscription.charged", created_at: 1 });
    expect(webhookDedupeKey(body)).toBe(webhookDedupeKey(body));
  });

  it("differs for two events that differ only in created_at", () => {
    const a = JSON.stringify({ event: "subscription.charged", created_at: 1 });
    const b = JSON.stringify({ event: "subscription.charged", created_at: 2 });
    expect(webhookDedupeKey(a)).not.toBe(webhookDedupeKey(b));
  });

  it("is a 64-char hex digest — never collides with a Razorpay event id", () => {
    // Pre-existing ProcessedWebhook rows hold header event ids ("evt_..."); the migration
    // that renamed the column relies on a hash being unable to collide with one.
    const key = webhookDedupeKey("{}");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("planUpdateForEvent", () => {
  it("grants PRO on activated/charged and takes the expiry from current_end", () => {
    for (const event of ["subscription.activated", "subscription.charged"]) {
      const update = planUpdateForEvent(event, entity());
      expect(update?.plan).toBe(Plan.PRO);
      expect(update?.planExpiresAt?.getTime()).toBe(1_756_600_000 * 1000);
    }
  });

  it("grants PRO on resumed — a paused subscription put back into billing", () => {
    expect(planUpdateForEvent("subscription.resumed", entity())?.plan).toBe(Plan.PRO);
  });

  it("falls back to a period from now when Razorpay omits current_end", () => {
    const before = Date.now();
    const update = planUpdateForEvent("subscription.charged", entity({ current_end: null }));
    expect(update?.plan).toBe(Plan.PRO);
    expect(update?.planExpiresAt?.getTime()).toBeGreaterThan(before);
  });

  it("drops to FREE and clears the expiry on every deactivating event", () => {
    for (const event of [
      "subscription.cancelled",
      "subscription.halted",
      "subscription.completed",
      "subscription.paused",
    ]) {
      expect(planUpdateForEvent(event, entity())).toEqual({
        plan: Plan.FREE,
        planExpiresAt: null,
      });
    }
  });

  it("returns null — do nothing — for events this handler does not act on", () => {
    for (const event of ["subscription.pending", "subscription.updated", "payment.captured"]) {
      expect(planUpdateForEvent(event, entity())).toBeNull();
    }
  });

  it("keys off the EVENT NAME, never entity.status", () => {
    // The status field is intentionally an unvalidated string; if this ever starts reading
    // it, an unexpected status could change a plan decision.
    expect(planUpdateForEvent("subscription.charged", entity({ status: "nonsense" }))?.plan).toBe(
      Plan.PRO,
    );
    expect(planUpdateForEvent("subscription.cancelled", entity({ status: "active" }))?.plan).toBe(
      Plan.FREE,
    );
  });

  it("has no event in both sets — one event cannot mean PRO and FREE at once", () => {
    for (const event of ACTIVATING_EVENTS) {
      expect(DEACTIVATING_EVENTS.has(event)).toBe(false);
    }
  });
});

describe("planForStatus", () => {
  it("maps active to PRO", () => {
    expect(planForStatus("active")).toBe(Plan.PRO);
  });

  it("maps every terminal status to FREE, including paused", () => {
    for (const status of ["cancelled", "halted", "completed", "expired", "paused"]) {
      expect(planForStatus(status)).toBe(Plan.FREE);
    }
  });

  it("refuses to act on transient statuses", () => {
    // `pending` is Razorpay's RETRY state — the subscription is still live. Repairing
    // against it would downgrade someone mid-authorisation.
    for (const status of ["created", "authenticated", "pending", "something_new"]) {
      expect(planForStatus(status)).toBeNull();
    }
  });

  it("agrees with the webhook path on paused — or the cron and the webhook fight forever", () => {
    expect(planForStatus("paused")).toBe(planUpdateForEvent("subscription.paused", entity())?.plan);
  });
});

describe("razorpayWebhookEventSchema", () => {
  const envelope = (overrides: Record<string, unknown> = {}) => ({
    event: "subscription.charged",
    created_at: 1_754_000_000,
    payload: { subscription: { entity: entity() } },
    ...overrides,
  });

  it("accepts a status it has never heard of instead of dropping the event", () => {
    // A z.enum here would fail OPEN: the route logs and acks 200 on a parse failure, so an
    // unlisted status on a `halted` payload would silently leave the tenant on PRO.
    const parsed = razorpayWebhookEventSchema.safeParse({
      event: "subscription.halted",
      payload: { subscription: { entity: entity({ status: "some_future_status" }) } },
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps notes.restaurantId — the webhook's only route back to the tenant", () => {
    const parsed = razorpayWebhookEventSchema.parse(
      envelope({
        payload: { subscription: { entity: entity({ notes: { restaurantId: "rest_abc" } }) } },
      }),
    );
    expect(parsed.payload?.subscription?.entity.notes?.restaurantId).toBe("rest_abc");
  });

  it("tolerates extra keys in notes without discarding restaurantId", () => {
    const parsed = razorpayWebhookEventSchema.parse(
      envelope({
        payload: {
          subscription: {
            entity: entity({ notes: { restaurantId: "rest_abc", source: "dashboard" } }),
          },
        },
      }),
    );
    expect(parsed.payload?.subscription?.entity.notes?.restaurantId).toBe("rest_abc");
  });

  it("accepts an envelope with no subscription payload at all (a plain payment.* event)", () => {
    const parsed = razorpayWebhookEventSchema.safeParse({ event: "payment.captured" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.payload?.subscription).toBeUndefined();
  });

  it("keeps created_at — the ordering guard has nothing to compare without it", () => {
    expect(razorpayWebhookEventSchema.parse(envelope()).created_at).toBe(1_754_000_000);
  });
});
