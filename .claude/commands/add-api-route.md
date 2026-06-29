---
description: Add a single API Route Handler with the mandatory ownership guard + Zod + tenant filter.
argument-hint: <module/path> <GET|POST|PATCH|DELETE> [zod-shape]
---
Add one Next.js Route Handler for **$ARGUMENTS** by delegating to the `route-builder` agent.

It must follow the mandatory route shape from `CLAUDE.md`:
- `restaurantId` from the URL param, never the body.
- `requireMember(restaurantId)` first (Better Auth session → `RestaurantMember` → 401/403).
- Body parsed through a Zod schema in `src/lib/validations/` (create it if missing, reuse if it exists — Grep first).
- All Prisma queries filtered by `restaurantId`.
- Consistent typed JSON envelope; `400` on validation failure.

If the path is an AI route, also wire the read-only SQL runner + per-tenant rate limit and flag it for `/review-sql-safety`. If it's a webhook, use raw-body signature verification + idempotency instead of `requireMember`.

Run `npx tsc --noEmit` and report the route + validator created.
