-- operato_ai_ro no longer needs to read its own audit log.
--
-- "AiQuery" and "WeeklySummary" were GRANTed to operato_ai_ro in the original bootstrap
-- alongside every other tenant table, and src/lib/ai/schema-context.ts has always withheld
-- them from the model's prompt on purpose: "AiQuery"."query" stores the raw text of past
-- user questions, so exposing the table would let a prompt injection planted in one
-- question be read back — and potentially re-executed — by a later one. RLS still scopes
-- both tables to the tenant's own rows, so this was never a cross-tenant leak, only a
-- durable prompt-injection channel and an unnecessary view of the model's own SQL history.
-- The prompt-level omission was correct; the grant it was working around was not.
--
-- Nothing in src/lib/ai/ reads either table via the AI (DATABASE_URL_AI) client — audit
-- rows are written and read through the regular read-write `prisma` client instead (see
-- text-to-sql.ts and weekly-summary.ts) — so this removes no capability the AI path uses.

REVOKE SELECT ON "AiQuery" FROM operato_ai_ro;
REVOKE SELECT ON "WeeklySummary" FROM operato_ai_ro;
