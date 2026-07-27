-- Staff gets the same treatment as Customer's PII columns (see the
-- ..._customer_phone_and_ai_pii migration, which this mirrors exactly).
--
-- operato_ai_ro previously held FULL-TABLE SELECT on "Staff", including salary, email,
-- and phone. src/lib/ai/schema-context.ts already withheld those columns from the model's
-- prompt — but that is a PROMPT-LEVEL choice, not a control: a model that guesses the
-- column name (or is prompt-injected into trying "SELECT * FROM \"Staff\"") could still
-- read them, and nothing in the database stopped it. This migration makes the omission
-- real. SELECT * on "Staff" now fails with permission denied, exactly like "Customer".

REVOKE SELECT ON "Staff" FROM operato_ai_ro;

GRANT SELECT (
  "id",
  "restaurantId",
  "name",
  "role",
  "isActive",
  "createdAt"
) ON "Staff" TO operato_ai_ro;
