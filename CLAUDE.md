# CLAUDE.md — Operato

Guidance for Claude Code (and any AI assistant) working in this repo. Read this before editing.

## What Operato is

A **multi-tenant AI SaaS for restaurants** — an AI assistant that talks to the tenant's *real* business database (text-to-SQL), plus weekly auto-summaries and smart inventory alerts. Built restaurant-first but architected as an **AI operating system for small businesses**: the tenant model, auth, billing, dashboard shell, and AI engine are vertical-agnostic; the restaurant domain is "vertical #1". The platform seam is `src/lib/verticals/`.

Status: greenfield. The repo currently holds the plan (`operato_project_plan.html`) and the docs under `docs/`. No app code exists yet.

## Stack (authoritative — supersedes the HTML plan)

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15** App Router, RSC + streaming | All app code under `/src` |
| Language | **TypeScript (strict)** | End-to-end types from Prisma → routes → UI |
| DB / ORM | **PostgreSQL (Neon) + Prisma** | Shared DB, `restaurantId` on every domain table |
| Auth | **Better Auth** (NOT Clerk) | Self-hosted; users live in our Postgres |
| Payments | **Razorpay** (NOT Stripe) | India/INR subscriptions |
| AI | **Google Gemini via Vercel AI SDK** (`@ai-sdk/google`, NOT Anthropic) | Pin the model in one constant |
| UI | Shadcn UI + Tailwind, TanStack Query, dnd-kit, Recharts | |
| Validation | Zod on every route input | |
| Uploads | Uploadthing | Menu/catalog images |
| Tests | Playwright (E2E) | |
| Jobs | Vercel Cron | Weekly summary |

Full migration details: [docs/stack-changes.md](docs/stack-changes.md). Folder layout: [docs/folder-structure.md](docs/folder-structure.md). Known issues in the original plan and their fixes: [docs/plan-code-review.md](docs/plan-code-review.md).

## Repo layout

```
src/app, src/components, src/lib, src/hooks, src/types   # all app code
prisma/ (schema.prisma, seed.ts)                          # root
tests/e2e/                                                # root, Playwright
public/, package.json, tsconfig.json, next.config.ts, vercel.json, .env   # root
```
`tsconfig.json` path alias: `"@/*": ["./src/*"]`. The public marketing site (landing + pricing) lives in `src/app/(marketing)` — static, no auth, SEO'd.

## Commands

```bash
npm run dev                       # Next dev server
npx prisma migrate dev --name x   # create + apply a migration (never edit a shipped one)
npx prisma generate               # regen client
npx prisma db seed                # load demo data
npx playwright test               # E2E
npx tsc --noEmit                  # typecheck
```

## Non-negotiable rules

These are load-bearing. Breaking any of them is a security or correctness bug, not a style nit.

1. **Tenant isolation is enforced, not assumed.**
   - Every domain table carries `restaurantId` (including `OrderItem`, `InventoryTransaction`, `Shift` — denormalized) with an FK to `Restaurant` and `onDelete: Cascade`.
   - `restaurantId` always comes **from the URL param, never the request body**.
   - **Every** API route under `src/app/api/restaurants/[restaurantId]/**` calls `requireMember(restaurantId)` at the top (Better Auth session → `RestaurantMember` lookup → 403 on miss). `layout.tsx` does NOT protect route handlers.
   - Every Prisma query is filtered by `restaurantId`. Postgres **Row-Level Security** is the backstop for the AI path.

2. **Text-to-SQL is sandboxed in code, never in the prompt.** A SELECT-only string check is not security. The AI SQL path must use: a dedicated **read-only Postgres role** + a separate `PrismaClient`; a **read-only transaction** with `statement_timeout`; a forced `LIMIT`; rejection of `;`, comments, and write keywords; **RLS** so a missing `WHERE` cannot cross tenants; and **`generateObject` + Zod** for the SQL step (never `JSON.parse` model text). Serialize `BigInt`/`Decimal` before `JSON.stringify` (see [serialize fix](docs/plan-code-review.md)).

3. **Auth = Better Auth.** Get the session with `auth.api.getSession({ headers: await headers() })`. `RestaurantMember` is keyed by `userId` (FK to Better Auth `user.id`), not `clerkUserId`. There is **no** user-sync webhook — create the Restaurant + owner member in one Prisma transaction at onboarding.

4. **Payments = Razorpay.** Verify the webhook signature (HMAC-SHA256 over the **raw** body, `x-razorpay-signature`) before trusting any plan change. Make webhooks idempotent (dedupe on event id) and add a reconciliation job. Never grant `PRO` from the client checkout handler — only from `subscription.activated`/`charged`.

5. **AI = Gemini via the AI SDK.** Use `google(MODEL)` with `MODEL` in one constant — `gemini-2.5-flash` interactive, `gemini-2.5-flash-lite` for the cron — so swaps are one line. Throttle the weekly-summary cron (it loops over all tenants on a shared free-tier key with a tight RPM) and add per-tenant daily rate limits on `/ai/query`.

6. **Money & stock are `Decimal`, never `Float`.** Wrap inventory `currentStock` + `balanceAfter` writes (and the order-pay → `Customer.totalSpend`/`visitCount` rollup) in a `$transaction` with a `SELECT ... FOR UPDATE` row lock.

7. **Migrations are append-only.** Create a new migration; never edit one that's been applied. For renames, hand-edit to `RENAME COLUMN` rather than drop+add (avoids data loss).

## Conventions

- Server Components for initial data; Client Components only where interactive.
- TanStack Query for mutations: optimistic update + rollback + `invalidateQueries`.
- Shadcn primitives come from `src/components/ui` (generated, don't hand-roll). Add with `npx shadcn add`.
- One Zod schema per route input, shared with the client form, living in `src/lib/validations/`.
- `src/lib/ai/` is pure logic, decoupled from React, so it's unit-testable.
- `schema-context.ts` fed to the AI is **generated** from the Prisma DMMF (plus curated example Q→SQL pairs) so it can't drift from the real schema.

## Subagents & skills available

Defined under `.claude/agents/` and `.claude/commands/`. Rationale and the full plan: [docs/agents-and-skills.md](docs/agents-and-skills.md).

- **Agents:** `prisma-modeler`, `route-builder`, `module-ui`, `sql-safety-reviewer` (read-only), `e2e-playwright`, `security-reviewer` (read-only).
- **Skills:** `/scaffold-module`, `/add-api-route`, `/generate-seed-data`, `/review-sql-safety`, `/new-vertical`.

Use `route-builder` for any endpoint (it bakes in the ownership guard). Gate AI-path changes behind `/review-sql-safety`, and merges behind `security-reviewer`.

## Don't

- Don't reintroduce Clerk, Stripe, or Anthropic/`claude-*` references — the stack changed. If you see them in the HTML plan, that copy is stale.
- Don't trust the original plan's Prisma schema verbatim — it has broken relations and missing `restaurantId`s; see [docs/plan-code-review.md](docs/plan-code-review.md) Finding 1–2.
- Don't put secrets in `NEXT_PUBLIC_*`. Only `NEXT_PUBLIC_RAZORPAY_KEY_ID` and the public Better Auth URL are client-safe.
