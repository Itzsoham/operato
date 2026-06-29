---
description: Run the text-to-SQL safety checklist + adversarial fixtures via the sql-safety-reviewer agent.
argument-hint: [file]
---
Audit Operato's text-to-SQL / AI path for safety by delegating to the `sql-safety-reviewer` agent. Scope: $ARGUMENTS (default: the whole AI SQL path — `src/lib/ai/*`, `src/app/api/restaurants/[restaurantId]/ai/query/route.ts`, and the validation/runner layer).

The agent must produce a per-rule PASS/FAIL report covering:
1. SELECT-only enforced in code (no `;`, comments, write keywords, data-modifying CTEs).
2. Tenant isolation via Postgres RLS + `SET LOCAL app.restaurant_id` (not a trusted `WHERE`); `restaurantId` is a real column on every queried table.
3. Read-only role + read-only transaction + `statement_timeout`.
4. Forced `LIMIT`.
5. `generateObject` + Zod (no `JSON.parse` of model text).
6. `BigInt`/`Decimal` serialized before `JSON.stringify`.
7. Per-tenant daily rate limit on `/ai/query`.

Also run the adversarial prompt fixtures (write attempts, cross-tenant attempts, prompt-injection strings) if present and report any that breach. This is a pre-launch gate — surface every FAIL with file:line and a concrete fix.
