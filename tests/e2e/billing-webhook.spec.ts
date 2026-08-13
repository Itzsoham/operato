import { createHmac, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

/**
 * The Razorpay webhook's idempotency guarantee, end to end.
 *
 * This is deliberately NOT a unit test. The guarantee does not live in any function —
 * it lives in the unique index on `ProcessedWebhook.dedupeKey` and in the fact that the
 * insert happens INSIDE the same transaction as the plan update. Only a real route against
 * a real Postgres proves that, which is why the pure crypto and plan-decision logic is
 * tested separately in tests/unit/billing.test.ts and this file covers what that cannot.
 *
 * The signed tests self-skip when RAZORPAY_WEBHOOK_SECRET is unset, which is the normal
 * state before a deployment exists to point Razorpay at (the secret is a value you choose
 * in Dashboard -> Settings -> Webhooks; there is nothing to configure until there is a
 * public URL). Set it in .env and they start running — no other setup.
 */

const WEBHOOK_PATH = "/api/webhooks/razorpay";

// Playwright's runner does not load .env the way `next dev` does, and the dev server this
// suite talks to reads its secret from there — so read the same file to stay in sync.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env (CI without one): the signed tests skip, the fail-closed test still runs.
}

const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

const sign = (body: string) => createHmac("sha256", SECRET!).update(body).digest("hex");

/**
 * An event for a subscription id that matches no restaurant, and carries no
 * `notes.restaurantId`. The route still records it in ProcessedWebhook (that is the point
 * — a stale event should not be reprocessed forever), so the dedupe path is exercised
 * fully without this test mutating any tenant's plan. Randomised per run so a previous
 * run's row cannot make the FIRST delivery look like a duplicate.
 */
function unmatchedEvent() {
  return JSON.stringify({
    event: "subscription.charged",
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      subscription: {
        entity: {
          id: `sub_e2e_${randomUUID().replace(/-/g, "")}`,
          status: "active",
          current_end: Math.floor(Date.now() / 1000) + 2_592_000,
        },
      },
    },
  });
}

test.describe("razorpay webhook", () => {
  test("rejects a request with no signature header — fails closed", async ({ request }) => {
    // True whether or not the secret is configured: an unset secret must mean "reject
    // everything", never "trust everything", so both branches answer 400.
    const res = await request.post(WEBHOOK_PATH, {
      headers: { "content-type": "application/json" },
      data: unmatchedEvent(),
    });
    expect(res.status()).toBe(400);
  });

  test.describe("with a configured secret", () => {
    test.skip(!SECRET, "RAZORPAY_WEBHOOK_SECRET is not set — nothing to sign against");

    test("rejects a body tampered with after signing", async ({ request }) => {
      const body = unmatchedEvent();
      const signature = sign(body);
      const tampered = body.replace("subscription.charged", "subscription.cancell");

      const res = await request.post(WEBHOOK_PATH, {
        headers: { "content-type": "application/json", "x-razorpay-signature": signature },
        data: tampered,
      });
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({ error: "Invalid signature" });
    });

    test("processes a signed event once, then reports the redelivery as a duplicate", async ({
      request,
    }) => {
      const body = unmatchedEvent();
      const headers = {
        "content-type": "application/json",
        "x-razorpay-signature": sign(body),
        "x-razorpay-event-id": `evt_${randomUUID()}`,
      };

      const first = await request.post(WEBHOOK_PATH, { headers, data: body });
      expect(first.status()).toBe(200);
      expect(await first.json()).toEqual({ ok: true });

      const second = await request.post(WEBHOOK_PATH, { headers, data: body });
      expect(second.status()).toBe(200);
      expect(await second.json()).toEqual({ ok: true, duplicate: true });
    });

    test("a replay with a fresh event-id header is still a duplicate", async ({ request }) => {
      // The regression test for the real finding: x-razorpay-event-id sits OUTSIDE the
      // HMAC, so keying idempotency on it let anyone holding one signed body replay it
      // indefinitely just by changing that header. The key is a hash of the signed bytes,
      // so rewriting the header changes nothing.
      const body = unmatchedEvent();
      const signature = sign(body);

      const first = await request.post(WEBHOOK_PATH, {
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
          "x-razorpay-event-id": `evt_${randomUUID()}`,
        },
        data: body,
      });
      expect(await first.json()).toEqual({ ok: true });

      const replay = await request.post(WEBHOOK_PATH, {
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
          // Different header, identical signed body.
          "x-razorpay-event-id": `evt_${randomUUID()}`,
        },
        data: body,
      });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual({ ok: true, duplicate: true });
    });

    test("acks an event shape it does not act on without recording a plan change", async ({
      request,
    }) => {
      // Retrying can never fix a shape mismatch, so answering non-2xx would just spin
      // Razorpay's retry loop for 24h.
      const body = JSON.stringify({ event: "payment.captured", created_at: 1 });
      const res = await request.post(WEBHOOK_PATH, {
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": sign(body),
          "x-razorpay-event-id": `evt_${randomUUID()}`,
        },
        data: body,
      });
      expect(res.status()).toBe(200);
    });
  });
});
