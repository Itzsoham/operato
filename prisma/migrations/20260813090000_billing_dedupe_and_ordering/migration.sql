-- Three fixes from the security review of the Razorpay surface. All DDL, no data loss.
--
-- 1. "Restaurant"."razorpayCustomerId" was UNIQUE, which is wrong.
--    billing/checkout/route.ts creates the Razorpay customer with `fail_existing: 0`,
--    which deliberately RETURNS THE EXISTING customer when one already has that email —
--    and the email is the OWNER's. One person may own several restaurants here
--    (OWNED_RESTAURANT_LIMIT = 5 in onboarding/actions.ts), so restaurant #2's checkout
--    got the SAME cust_xxx as restaurant #1 and died on this index with an unhandled 500.
--    Not self-healing either: the column stayed NULL, so every retry hit it again and that
--    owner could never reach Checkout for their second restaurant. One Razorpay customer
--    legitimately maps to N restaurants; the index encoded a 1:1 that is not true.
DROP INDEX "Restaurant_razorpayCustomerId_key";

-- 2. Razorpay redelivers webhooks for ~24h and does not guarantee ORDER, so a retried
--    subscription.charged can land after a subscription.cancelled and silently re-grant
--    PRO to someone who cancelled. Stamping the provider's own event time lets the handler
--    drop an event older than the one already applied. NULL means "never set by a billing
--    event" — the first event of any kind wins, which is correct.
ALTER TABLE "Restaurant" ADD COLUMN "planUpdatedAt" TIMESTAMP(3);

-- 3. Idempotency was keyed on the x-razorpay-event-id HEADER, which sits OUTSIDE the HMAC
--    (Razorpay signs the body only). Anyone holding one validly-signed body could replay
--    it indefinitely just by varying that header, and each replay would look like a fresh
--    event — enough to re-grant PRO after a cancellation, or force a downgrade. The key is
--    now a SHA-256 of the raw signed bytes: a genuine redelivery is byte-identical and
--    collides, two distinct events never do (created_at and entity ids differ).
--
--    RENAME, not drop+add (rule 7) — the existing rows are real processed-event records and
--    must survive. Those rows hold header event ids rather than body hashes; that is fine,
--    a hash can never collide with one, so the worst case is that a webhook delivered
--    before this migration would be reprocessed if Razorpay redelivered it afterwards.
ALTER TABLE "ProcessedWebhook" RENAME COLUMN "eventId" TO "dedupeKey";
ALTER INDEX "ProcessedWebhook_eventId_key" RENAME TO "ProcessedWebhook_dedupeKey_key";

ALTER TABLE "ProcessedWebhook" ADD COLUMN "providerEventId" TEXT;

-- Preserve the tracing value of the old column: every pre-existing row's key WAS a
-- provider event id, so it belongs in the new column rather than being thrown away.
UPDATE "ProcessedWebhook" SET "providerEventId" = "dedupeKey";

-- No AI grants to adjust. "ProcessedWebhook" is REVOKE ALL'd from operato_ai_ro
-- (..._rls_and_ai_grants), and "Restaurant" is column-level granted
-- (..._ai_column_grants_remaining_tables), so the new planUpdatedAt column is unreadable
-- by the AI role by default — which is what we want.
