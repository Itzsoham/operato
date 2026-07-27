-- Closes the tenant-pivot vector at the database, not just in application code.
--
-- set_config() sets a Postgres session/transaction GUC, including app.restaurant_id — the
-- value Row-Level Security reads to decide which tenant's rows exist. It is an ORDINARY
-- FUNCTION, not a data write, so operato_ai_ro's read-only role, its read-only
-- transaction, and the AI executor's LIMIT wrapper all permit calling it from inside a
-- plain SELECT. src/lib/ai/sql-guard.ts blocks the obvious spellings of that call
-- (set_config(...), "set_config"(...)) but an sql-safety-reviewer audit found a live,
-- verified bypass: Postgres's Unicode-escaped identifier syntax (U&"\0073et_config") never
-- contains the literal text "set_config" anywhere in the SQL string, so no keyword rule —
-- however it's written — can ever catch every spelling. A regex is not the boundary.
--
-- The database is. PostgreSQL functions are executable by PUBLIC by default (every role,
-- implicitly), so a REVOKE targeted at operato_ai_ro alone would be a no-op: the role would
-- still reach the function through its PUBLIC membership. Revoking from PUBLIC and
-- re-granting only to the roles that legitimately need it is what actually removes the
-- capability from operato_ai_ro — verified against this database's live role list
-- (cloud_admin is a superuser and ignores REVOKE entirely by design; neon_service and
-- neondb_owner are the other two non-superuser logins that exist here).
--
-- Application code no longer calls set_config either (see run-readonly-sql.ts — it now
-- uses SET LOCAL with an asserted, trusted literal), so this revoke does not remove any
-- capability this codebase actually uses.

REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;

-- Restore it only for the roles that own/administer the database. Neither of these is
-- reachable by model-authored SQL: operato_ai_ro is the only role the AI path ever
-- connects as, and it is deliberately NOT in this list.
GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO neondb_owner;
GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO neon_service;
