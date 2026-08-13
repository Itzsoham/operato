import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The two pure crypto decisions behind /api/webhooks/razorpay, kept out of the route so
 * they can be tested directly — the same split as sql-guard.ts and inventory-alert-rules.ts.
 * Everything here is a pure function of its arguments: no env, no I/O, no Prisma.
 */

/**
 * Constant-time HMAC-SHA256 check of a Razorpay webhook body.
 *
 * HAND-ROLLED ON PURPOSE — do NOT replace this with the SDK's
 * `razorpay/dist/utils/razorpay-utils`.`validateWebhookSignature`. That function computes
 * the same HMAC correctly and then finishes with a plain `expectedSignature === signature`
 * (v2.9.8, line 72), which is not constant-time and reintroduces exactly the timing
 * side-channel this exists to avoid. Same pattern as `isAuthorized` in the cron routes.
 *
 * `rawBody` must be the EXACT bytes Razorpay sent. Parsing the JSON and re-stringifying it
 * produces different bytes (key order, whitespace) and a valid signature would then fail.
 */
export function isValidWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  // timingSafeEqual THROWS on a length mismatch rather than returning false, so the length
  // check has to come first. It is not a useful oracle: the expected length is a fixed
  // public constant (64 hex chars for SHA-256).
  if (expectedBuf.length !== signatureBuf.length) return false;

  return timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * The idempotency key for a delivery: a SHA-256 over the raw SIGNED bytes.
 *
 * Explicitly NOT the `x-razorpay-event-id` header. The HMAC covers the body only, so that
 * header is attacker-controlled — anyone holding a single validly-signed body could replay
 * it indefinitely by varying the header, and every replay would look like a fresh event
 * (enough to re-grant PRO after a cancellation, or force a downgrade). Razorpay's
 * signature carries no timestamp, so this is the only replay defence available, and it has
 * to key off something the signature actually covers.
 *
 * Sound as a key in both directions: a genuine redelivery is byte-identical and therefore
 * collides, while two distinct events always differ somewhere (`created_at`, entity ids).
 */
export function webhookDedupeKey(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
