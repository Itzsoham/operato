-- Tenant isolation for the AI (text-to-SQL) path, enforced by Postgres itself.
--
-- Two independent mechanisms, because the AI writes the SQL and we cannot trust it
-- to include a correct WHERE clause:
--
--   1. RLS    -- a query with NO `WHERE "restaurantId" = ...` still returns only the
--                active tenant's rows. The tenant comes from `app.restaurant_id`, a
--                GUC the AI transaction sets with SET LOCAL; the model never supplies it.
--   2. GRANTS -- the AI role cannot see tables it has no business reading at all
--                (credentials, sessions, billing webhooks).
--
-- WHY THE APP IS UNAFFECTED: `neondb_owner` OWNS these tables, and a table owner is
-- exempt from RLS unless FORCE ROW LEVEL SECURITY is set. We deliberately do NOT set
-- it, so the app's read/write client keeps working normally and enforces tenancy in
-- code (requireMember + a restaurantId filter). `operato_ai_ro` does not own the
-- tables, so RLS DOES bind it.
--
-- FAIL-CLOSED: current_setting('app.restaurant_id', true) returns NULL when unset, and
-- `"restaurantId" = NULL` is NULL -- never true. So a forgotten SET LOCAL yields ZERO
-- rows, not every row.

-- 1. RLS on every tenant-scoped table -----------------------------------------

ALTER TABLE "MenuCategory"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MenuItem"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RestaurantTable"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryItem"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Staff"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shift"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiQuery"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklySummary"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RestaurantMember"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Restaurant"           ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "MenuCategory"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "MenuItem"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "RestaurantTable"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "Order"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "OrderItem"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "InventoryItem"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "InventoryTransaction"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "Customer"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "Staff"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "Shift"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "AiQuery"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "WeeklySummary"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
CREATE POLICY tenant_isolation ON "RestaurantMember"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));

-- Restaurant is keyed by `id`, not `restaurantId`.
CREATE POLICY tenant_isolation ON "Restaurant"
  USING ("id" = current_setting('app.restaurant_id', true));

-- 2. Strip the AI role's access to tables it must never read -------------------
--
-- The role was bootstrapped with GRANT SELECT ON ALL TABLES, which swept in Better
-- Auth's tables. `account` stores PASSWORD HASHES and OAuth tokens; `session` stores
-- live SESSION TOKENS. A text-to-SQL prompt injection that reached those would be an
-- account takeover, and RLS cannot help -- they have no restaurantId to filter on.
-- The AI has no legitimate question that needs them, so revoke outright.

REVOKE ALL ON "user"         FROM operato_ai_ro;
REVOKE ALL ON "session"      FROM operato_ai_ro;
REVOKE ALL ON "account"      FROM operato_ai_ro;
REVOKE ALL ON "verification" FROM operato_ai_ro;

-- Billing webhook bookkeeping: not tenant data, nothing to ask about.
REVOKE ALL ON "ProcessedWebhook" FROM operato_ai_ro;

-- Prisma's migration ledger: schema internals, not business data.
-- Guarded: Prisma creates this table itself, OUTSIDE the migration list, so it does
-- not exist in the shadow database used to validate migrations. An unguarded REVOKE
-- there fails with 42P01 and blocks the whole migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
  ) THEN
    EXECUTE 'REVOKE ALL ON "_prisma_migrations" FROM operato_ai_ro';
  END IF;
END
$$;

-- RestaurantMember is RLS-protected above, but it only maps users to tenants -- it
-- answers no business question. Deny it too rather than rely on RLS alone.
REVOKE ALL ON "RestaurantMember" FROM operato_ai_ro;

-- 3. Make FUTURE tables fail CLOSED for the AI role ---------------------------
--
-- The bootstrap ran:
--   ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO operato_ai_ro;
-- which auto-grants SELECT on every table created from then on. That is fail-OPEN,
-- and it already fired once: Better Auth's tables were created after the bootstrap
-- and the AI role silently gained read access to password hashes and session tokens
-- (revoked by name above). The next migration to add a sensitive table would quietly
-- reopen the same hole, and a new table has no RLS policy until someone adds one.
--
-- So: drop the blanket default, and require every future tenant table to opt IN
-- explicitly. A forgotten GRANT means the AI cannot see a table (a visible, harmless
-- bug). A forgotten REVOKE under the old rule meant the AI could see everything.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  REVOKE SELECT ON TABLES FROM operato_ai_ro;

-- 4. The explicit allowlist: exactly what the AI may read -----------------------
--
-- Idempotent, and the point of reproducibility: on a database built from scratch
-- (no blanket bootstrap grant), THESE are the only tables the AI role can see.
-- Adding a table to the AI's reach is now one deliberate, reviewable line.
GRANT SELECT ON "Restaurant"           TO operato_ai_ro;
GRANT SELECT ON "MenuCategory"         TO operato_ai_ro;
GRANT SELECT ON "MenuItem"             TO operato_ai_ro;
GRANT SELECT ON "RestaurantTable"      TO operato_ai_ro;
GRANT SELECT ON "Order"                TO operato_ai_ro;
GRANT SELECT ON "OrderItem"            TO operato_ai_ro;
GRANT SELECT ON "InventoryItem"        TO operato_ai_ro;
GRANT SELECT ON "InventoryTransaction" TO operato_ai_ro;
GRANT SELECT ON "Customer"             TO operato_ai_ro;
GRANT SELECT ON "Staff"                TO operato_ai_ro;
GRANT SELECT ON "Shift"                TO operato_ai_ro;
GRANT SELECT ON "AiQuery"              TO operato_ai_ro;
GRANT SELECT ON "WeeklySummary"        TO operato_ai_ro;

-- Checklist for any migration that adds a tenant table:
--   ALTER TABLE "New" ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON "New"
--     USING ("restaurantId" = current_setting('app.restaurant_id', true));
--   GRANT SELECT ON "New" TO operato_ai_ro;   -- only if the AI should read it
--
-- Verify with (must return ZERO rows -- readable but unprotected):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r'
--      AND has_table_privilege('operato_ai_ro', c.oid, 'SELECT')
--      AND NOT c.relrowsecurity;
