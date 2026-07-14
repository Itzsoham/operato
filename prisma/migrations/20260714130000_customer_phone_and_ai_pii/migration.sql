-- Customer.phone: canonical, required. And the AI must not read PII.

-- 1. Canonicalise existing numbers to E.164 -----------------------------------
--
-- `@@unique([restaurantId, phone])` is a unique index on the RAW STRING, so
-- "+91 98765 43210", "9876543210" and "+919876543210" are three different values —
-- one human, three rows, lifetime spend split three ways, and "top customers" (the report
-- the CRM exists to produce) simply wrong. Normalise now, while the data is still clean;
-- every day of real traffic makes this harder.
--
-- Matches normalisePhone() in src/lib/validations/customers.ts. Leading trunk zeros are
-- stripped; a bare 10-digit number gets +91 (India — see Restaurant.currency).
UPDATE "Customer"
   SET "phone" = CASE
     WHEN "phone" LIKE '+%'
       THEN '+' || regexp_replace(substring("phone" from 2), '\D', '', 'g')
     ELSE (
       WITH d AS (
         SELECT regexp_replace(regexp_replace("phone", '\D', '', 'g'), '^0+', '') AS n
       )
       SELECT CASE
         WHEN length(d.n) = 10 THEN '+91' || d.n
         WHEN length(d.n) = 12 AND d.n LIKE '91%' THEN '+' || d.n
         ELSE '+' || d.n
       END FROM d
     )
   END
 WHERE "phone" IS NOT NULL;

-- 2. Required ------------------------------------------------------------------
--
-- The rule "never create a Customer without a phone" lived only in Zod. That is not
-- enforcement: NULLs are DISTINCT in Postgres, so the unique index above would allow a
-- hundred phone-less rows — one per anonymous takeaway — inflating the customer count and
-- wrecking the figures the CRM reports. There are zero such rows today, so this is free.
--
-- (An order with no phone still carries customerId = NULL and is still counted in revenue.
--  It is simply not attributed to a person. That is the honest answer.)
DELETE FROM "Customer" WHERE "phone" IS NULL;
ALTER TABLE "Customer" ALTER COLUMN "phone" SET NOT NULL;

-- 3. The AI role must not read PII ---------------------------------------------
--
-- RLS already stops the AI reading ANOTHER tenant's customers. It does nothing about
-- WHICH COLUMNS of its own tenant's customers it can read — and a table-level grant means
-- a model-written `SELECT *` pulls phone numbers and email addresses into the prompt, and
-- from there to Google.
--
-- The AI needs none of that to answer "who are my top customers". Column-level grants make
-- `SELECT *` on this table fail with permission denied, which is exactly right: the query
-- must name the columns it is allowed to see, and schema-context.ts will list only these.
REVOKE SELECT ON "Customer" FROM operato_ai_ro;

GRANT SELECT (
  "id",
  "restaurantId",
  "name",
  "totalSpend",
  "visitCount",
  "lastVisitAt",
  "tags",
  "createdAt"
) ON "Customer" TO operato_ai_ro;
