# Building Operato with Claude Code: Agents & Skills Plan

A grounded plan for one solo developer building **Operato** (a multi-tenant AI SaaS for restaurants) largely *with* Claude Code. It answers the only questions that matter at the start: **how many subagents and skills do I actually need, which specific ones, and why.**

This plan is deliberately small. The failure mode for a solo dev is building 20 agents you have to maintain and never use. The win is 5-7 sharp subagents plus 4-6 slash-commands that encode the *non-negotiable* rules of this codebase — multi-tenant isolation, Zod-validated routes, and a provably safe text-to-SQL path — so the AI stops re-deriving them (and re-breaking them) on every file.

> **Stack context this plan assumes.** Next.js 16 App Router (RSC + streaming — see [nextjs-16-notes.md](nextjs-16-notes.md); it is **not** Next 15), TypeScript strict, Prisma + Neon Postgres, Shadcn + Tailwind + TanStack Query + Zod + dnd-kit + Recharts, **Better Auth** (replaces Clerk), **Razorpay** (replaces Stripe), **Google Gemini 2.5 Flash via the Vercel AI SDK `@ai-sdk/google`** (replaces Anthropic Claude), Uploadthing, Playwright, Vercel Cron. All app code under `/src`; `prisma/`, `tests/`, `public/`, and config at the repo root. Every domain table carries `restaurantId`; membership is the `RestaurantMember` table.

---

## 1. When to use a Subagent vs a Skill vs inline prompting

Three different tools for three different shapes of work. Pick by **context isolation** and **reuse**, not by how "important" the task feels.

| Mechanism | What it is | Use it when | Cost / caveat |
|---|---|---|---|
| **Subagent** (`.claude/agents/*.md`) | A specialized assistant with its **own system prompt, its own context window, and a restricted tool list**. Claude delegates a whole sub-task to it and gets back a summary. | The work is **multi-step**, benefits from a **narrow persona + rules**, and you want it to *not* pollute the main thread's context (e.g. "review every generated SQL path for safety", "scaffold and wire a full module"). Also when you want to **restrict tools** (a reviewer that can read + run tests but not edit). | Separate context = it can't see your main conversation by default; you pay the cost of re-establishing context. Overhead isn't worth it for a one-liner. |
| **Skill / slash-command** (`.claude/commands/*.md` or a packaged skill) | A **reusable, parameterized procedure or checklist** you invoke explicitly (`/scaffold-module Supplier`). Runs **in the current context**. | You repeat the **same procedure** with different inputs (scaffold a CRUD module, add an API route, run the SQL-safety checklist). It's a *recipe*, not a *persona*. | Runs inline, so it shares (and can crowd) the main context. No tool sandboxing of its own. |
| **Inline prompt** | Just asking in the main thread. | **One-off** work, exploration, or anything where writing a reusable artifact costs more than the task itself. "Rename this variable", "why is this query slow". | Nothing reusable is captured. That's fine — most work is inline. |

Rules of thumb for this project:

- **Encode a rule once, enforce it everywhere → Skill.** The ownership check, the Zod-first route shape, the SQL safety checklist are *procedures*. They become slash-commands so they're literally the same every time.
- **Delegate judgment in a clean room → Subagent.** "Is this generated SQL safe?" and "is this diff a tenant-isolation leak?" are *review* tasks that you want done by a focused persona with a fixed checklist and no distractions from the 200 lines of UI you were just writing.
- **Don't wrap a single tool call in an agent.** If it's "run `prisma migrate dev`", that's a bash command, not an agent.
- **A skill can call a subagent.** `/scaffold-module` can generate the module, then hand the diff to the security-reviewer agent. Compose them.

---

## 2. Recommended Subagents (7)

Seven agents, mapped to the recurring *kinds of work* in Operato: **data layer, API layer, UI layer, the AI engine, the AI-safety problem, end-to-end tests, and security review**. A seed-data agent is intentionally demoted to a *skill* (section 3) because it's a run-once recipe, not an ongoing persona.

> **Revision (Jul 2026).** This section originally listed six agents and mapped the AI phases to `route-builder` + `sql-safety-reviewer`. That left a hole: `route-builder` owns the *route*, `sql-safety-reviewer` is read-only and can only *audit* — so nobody owned `src/lib/ai/` itself, which is simultaneously the product's core value and its highest-risk code. `ai-engineer` (§2.7) fills it.

### 2.1 `prisma-modeler` — schema & migration agent

| | |
|---|---|
| **Purpose** | Designs/edits `prisma/schema.prisma` models and runs safe, reversible migrations. |
| **When to invoke** | Adding or changing a domain table (Menu, Order, InventoryTransaction, Shift, etc.), adding indexes, or wiring a new relation. |
| **Key tools** | `Read`, `Edit`, `Bash` (`prisma migrate dev`, `prisma generate`, `prisma format`, `prisma validate`). |
| **Phase / module** | Foundation + every module's data slice. |
| **Non-negotiables it enforces** | Every domain model has `restaurantId` + an FK to `Restaurant` with `onDelete: Cascade`; composite `@@index([restaurantId, ...])` on every date/status filter the AI will hit; `Decimal` for money/stock (never `Float`); never edit a shipped migration — always create a new one. |

### 2.2 `route-builder` — API route + Zod + ownership agent

| | |
|---|---|
| **Purpose** | Generates Next.js Route Handlers under `src/app/api/restaurants/[restaurantId]/**` with Zod-validated input and the per-route membership check. |
| **When to invoke** | Any new/changed API endpoint for a module. |
| **Key tools** | `Read`, `Edit`, `Bash` (typecheck), `Grep` (to reuse existing validators). |
| **Phase / module** | Every module + the AI endpoints + webhooks. |
| **Non-negotiables it enforces** | `restaurantId` comes **from the URL param, never the request body**; every handler first calls the membership guard (Better Auth session → `RestaurantMember` lookup for that `restaurantId`) and returns `403` on miss; body parsed through a Zod schema in `src/lib/validations/*`; all Prisma queries are filtered by the URL `restaurantId`; consistent error envelope. |

> This is the single highest-leverage agent in the project. The shared-DB tenancy model means **one forgotten `where: { restaurantId }` is a cross-tenant data leak.** Encoding that into a delegated agent (not your tired fingers at 1am) is the point.

### 2.3 `module-ui` — Shadcn + TanStack Query CRUD screen agent

| | |
|---|---|
| **Purpose** | Builds a module's client UI: list/table, create/edit dialogs, optimistic mutations, loading/empty/error states. |
| **When to invoke** | Standing up or revising a dashboard module screen (Menu, Orders/Tables grid, Inventory, Customers, Staff). |
| **Key tools** | `Read`, `Edit`, `Bash` (`npx shadcn add`, dev build/typecheck), `Grep`. |
| **Phase / module** | Menu → Orders/Tables → Inventory → Customers → Staff → Overview. |
| **Non-negotiables it enforces** | Server Components for initial data, Client Components only where interactive; TanStack Query for mutations with optimistic update + rollback and `invalidateQueries`; Zod schema shared with the route; Shadcn primitives from `src/components/ui` (never hand-rolled); `dnd-kit` for menu/category reordering; Recharts on the Overview. |

### 2.4 `sql-safety-reviewer` — text-to-SQL / AI-safety auditor

| | |
|---|---|
| **Purpose** | Audits the AI text-to-SQL path: that generated SQL is **read-only, tenant-scoped, table-whitelisted, and parameterized**. The single most security-sensitive feature in Operato. |
| **When to invoke** | Any change to `src/lib/ai/text-to-sql.ts`, `schema-context.ts`, the `ai/query` route, or the validation layer between Gemini's output and `$queryRawUnsafe`/`$queryRaw`. |
| **Key tools** | `Read`, `Grep`, `Bash` (run the AI-path unit tests + a set of adversarial prompt fixtures). **No `Edit`** — it reports, it doesn't silently rewrite the safety layer. |
| **Phase / module** | AI Phase (text-to-SQL assistant). |
| **Non-negotiables it audits** | (1) statement must be a single `SELECT` — reject any `INSERT/UPDATE/DELETE/DROP/ALTER/;`-stacked/CTE-write; (2) `restaurantId` injected **as a bound parameter**, never string-interpolated, on **every** queried table; (3) referenced tables ⊆ an allowlist; (4) a hard `LIMIT`; (5) executed on a **read-only DB role / least-privilege connection**; (6) raw model output is never trusted — validation happens in our code, not in the prompt. |

> Why a dedicated agent and not just the security reviewer: the failure modes here are *specific and adversarial* (prompt injection turning a question into a write, or a missing tenant filter exfiltrating another restaurant's revenue). It deserves its own checklist and its own clean context. Gemini 2.5 Flash returning JSON does **not** make the output trustworthy — the guarantees must live in deterministic code, and this agent verifies they do.

### 2.5 `e2e-playwright` — end-to-end test agent

| | |
|---|---|
| **Purpose** | Writes and maintains Playwright specs for the critical flows. |
| **When to invoke** | After a module's UI + route are wired, and for the auth/order/AI happy paths before launch. |
| **Key tools** | `Read`, `Edit`, `Bash` (`npx playwright test`, `--ui`, install browsers). |
| **Phase / module** | Testing/Polish phase; smoke coverage as each module lands. |
| **Non-negotiables it enforces** | Cover auth (sign-in + a **tenant-isolation negative test**: member of A cannot load B's dashboard), order create→pay pipeline, and the AI query flow; use stable `data-testid`s, not brittle text selectors; seeded test tenant; no reliance on live Gemini calls (mock/stub the AI route). |

### 2.6 `security-reviewer` — general security & multi-tenancy auditor

| | |
|---|---|
| **Purpose** | Reviews diffs for tenancy leaks, authz gaps, secret handling, and webhook/payment verification — the cross-cutting concerns the other agents don't own. |
| **When to invoke** | Before merging anything touching auth, Razorpay webhooks, Uploadthing, env/secrets, or any handler that reads `restaurantId`. |
| **Key tools** | `Read`, `Grep`, `Bash` (typecheck, `npm audit`). **No `Edit`** — review-only. |
| **Phase / module** | Cross-cutting; gate before each merge to `main`. |
| **Non-negotiables it audits** | Membership check present on every protected route; **Razorpay webhook signature verified** (`validateWebhookSignature` from `razorpay/dist/utils/razorpay-utils`) and payment verified (`validatePaymentVerification`) before trusting any plan change; Better Auth session validated server-side (`auth.api.getSession({ headers: await headers() })`); no secret in client bundles / `NEXT_PUBLIC_`; cron route protected by `CRON_SECRET`; Uploadthing auth callback scoped to the tenant. |

### 2.7 `ai-engineer` — the AI engine builder

| | |
|---|---|
| **Purpose** | **Builds** `src/lib/ai/` — the text-to-SQL engine, DMMF-generated `schema-context.ts`, the weekly-summary logic, and smart inventory alerts. The counterpart to `sql-safety-reviewer`: this one writes, that one audits. |
| **When to invoke** | Any change under `src/lib/ai/`. Pair every invocation with `/review-sql-safety`. |
| **Key tools** | `Read`, `Edit`, `Grep`, `Bash` (typecheck, AI-path unit tests). |
| **Phase / module** | AI Phase (all three AI features) + `/new-vertical`'s schema-context. |
| **Non-negotiables it enforces** | The five defenses, all of them: dedicated read-only role + separate `PrismaClient` (`DATABASE_URL_AI`); read-only transaction + `statement_timeout` + forced `LIMIT`; **RLS** as the real tenant guarantee (not the `WHERE` clause); static rejection as a pre-filter only; `generateObject` + Zod (never `JSON.parse` of model text). Plus: `BigInt`/`Decimal` serialized before `JSON.stringify`, model pinned in one constant, cron throttled against the free-tier RPM. |

> Why not fold this into `route-builder`: the route is ~30 lines of guard-and-delegate; the engine is where every actual failure mode lives. And why not into `sql-safety-reviewer`: that agent is deliberately **read-only** — a reviewer that can rewrite the safety layer it just approved is not a reviewer. Keeping build and audit in separate contexts is the whole point.

### Why seven, and why not more

- **Each agent owns one layer/concern with a hard rule set.** That's the unit that earns separate context and a tool sandbox. More agents would mean overlapping responsibilities and you guessing which to invoke.
- **Two reviewers, deliberately.** `sql-safety-reviewer` is *narrow and adversarial* (the AI path); `security-reviewer` is *broad* (everything else). Merging them dilutes the AI checklist — the highest-risk surface — into a generic pass. Both are **read-only** so they advise rather than quietly "fix" security code.
- **Build and audit never share a persona.** `ai-engineer` writes the SQL path; `sql-safety-reviewer` verifies it. The separation is the control.
- **No `frontend-styling` / `docs` / `refactor` agents.** Those are inline work or one-shot skills; a persona buys nothing.
- **Seed data is a skill, not an agent** (next section) — it's a run-once recipe, executed in-context, not an ongoing reviewer/builder persona.

---

## 3. Recommended Skills / Slash-Commands (5)

Recipes you invoke by name. They encode *the same steps every time* and lean on the agents above where judgment is needed.

### `/scaffold-module <Name> [fields...]`
- **Does:** Generates a full vertical slice for a new CRUD module: Prisma model (via `prisma-modeler`), Zod validators, API route (via `route-builder`), TanStack Query hooks, and the Shadcn UI screen (via `module-ui`), plus a sidebar nav entry. Then hands the diff to `security-reviewer`.
- **Trigger:** Standing up a new module or sub-entity (e.g. `Supplier`, `Reservation`).
- **Inputs:** Module name + field list (name\:type, optional flags). **Outputs:** schema model + migration, `src/lib/validations/<name>.ts`, `src/app/api/restaurants/[restaurantId]/<name>/route.ts`, `src/app/dashboard/[restaurantId]/<name>/page.tsx`, query hooks, nav item.

### `/add-api-route <module> <method>`
- **Does:** Adds a single Route Handler with the mandatory shape — Better Auth session → `RestaurantMember` ownership check (403 on miss) → Zod parse → tenant-filtered Prisma call → typed JSON envelope. `restaurantId` only from the URL.
- **Trigger:** Need one endpoint without a whole module.
- **Inputs:** module/path + HTTP method + (optional) Zod shape. **Outputs:** the route file + its validator, wired to the ownership guard.

### `/generate-seed-data [months=3]`
- **Does:** Writes/updates `prisma/seed.ts` to produce realistic, *correlated* demo data — one or two restaurants, members, menu + categories, ~3 months of orders with believable daily/weekend patterns, derived `Customer.totalSpend`/`visitCount`, inventory transactions with correct `balanceAfter`, staff + shifts. This is what makes the AI features look real in a demo instead of empty.
- **Trigger:** After core modules exist; before AI work; before recording the demo.
- **Inputs:** months of history, restaurant count. **Outputs:** runnable `prisma/seed.ts` (idempotent), invoked via `prisma db seed`.

### `/review-sql-safety`
- **Does:** Runs the text-to-SQL safety checklist by delegating to `sql-safety-reviewer`, plus executes the adversarial prompt fixtures (write attempts, cross-tenant attempts, prompt-injection strings) and reports pass/fail per rule.
- **Trigger:** Any edit to the AI SQL path, and as a pre-launch gate.
- **Inputs:** none (operates on the AI path) or a specific file. **Outputs:** a checklist report (SELECT-only ✓, bound `restaurantId` ✓, table allowlist ✓, `LIMIT` ✓, read-only role ✓) and a list of any fixtures that breached.

### `/new-vertical <name>`
- **Does:** Stamps out a vertical config pack under `src/lib/verticals/<name>.ts` — domain entity aliases (Menu→Catalog, Tables→Counters), dashboard KPIs, terminology/onboarding copy, and the **AI `schema-context` + example question→SQL pairs** for that vertical. This is the platform seam from the project plan.
- **Trigger:** Adding industry #2+ (café, bakery, cloud kitchen, retail).
- **Inputs:** vertical name + entity remapping. **Outputs:** `src/lib/verticals/<name>.ts` plus a registered schema-context the AI route can select.

> Note: `/scaffold-module` and `/add-api-route` overlap by design — the first composes the second. Keep both: you frequently need just one route, and you don't want to scaffold a whole module to get it.

---

## 4. Phase / Module → Agents + Skills

| Build phase / module | Lean on (agents) | Lean on (skills) |
|---|---|---|
| **Foundation** — Next.js + Better Auth + Prisma/Neon, onboarding, membership sync | `prisma-modeler`, `route-builder`, `security-reviewer` | `/add-api-route` |
| **Menu & Items** (dnd-kit reorder, Uploadthing images) | `prisma-modeler`, `route-builder`, `module-ui` | `/scaffold-module` |
| **Orders & Tables** (table grid, status pipeline, pay→customer rollup) | `prisma-modeler`, `route-builder`, `module-ui` | `/scaffold-module` |
| **Inventory & Stock** (transactions, `balanceAfter`, low-stock) | `prisma-modeler`, `route-builder`, `module-ui` | `/scaffold-module` |
| **Customers / CRM** | `route-builder`, `module-ui` | `/scaffold-module` |
| **Staff & Shifts** | `prisma-modeler`, `route-builder`, `module-ui` | `/scaffold-module` |
| **Overview dashboard** (Recharts KPIs, latest weekly summary) | `module-ui` | — |
| **Seed data** (3-month realistic demo) | — | `/generate-seed-data` |
| **AI #1 — Text-to-SQL assistant** | `ai-engineer` (builds), `sql-safety-reviewer` (audits), `route-builder` (the endpoint) | `/review-sql-safety` |
| **AI #2 — Weekly summary (Vercel Cron)** | `ai-engineer`, `route-builder`, `security-reviewer` | — |
| **AI #3 — Smart inventory alerts** | `ai-engineer`, `route-builder` | — |
| **Auth (Better Auth)** | `route-builder`, `security-reviewer` | `/add-api-route` |
| **Payments (Razorpay)** | `route-builder`, `security-reviewer` | `/add-api-route` |
| **Testing / Polish / Launch** | `e2e-playwright`, `security-reviewer` | `/review-sql-safety` |
| **Platform — vertical #2+** | `prisma-modeler`, `module-ui`, `ai-engineer`, `sql-safety-reviewer` | `/new-vertical` |

---

## 5. Recommended files to create (spec — not the bodies)

Create these under `.claude/agents/`. Each row is a spec the developer turns into the actual Markdown file (YAML frontmatter `name`, `description`, `tools`, `model` + a system-prompt body). Reviewers are **read-only** (omit `Edit`/`Write` from `tools`). Use **Haiku/Sonnet-class** models for fast deterministic generators and **Opus-class** for adversarial review where judgment matters; pin per the model ids live in your Claude Code config at build time.

```text
# target: .claude/agents/prisma-modeler.md
prisma-modeler        Schema & migration specialist. Edits prisma/schema.prisma,
                      enforces restaurantId + cascade FK + composite indexes + Decimal money,
                      runs migrate/generate. Tools: Read, Edit, Bash. Model: Sonnet-class.

# target: .claude/agents/route-builder.md
route-builder         API Route Handler generator. URL-only restaurantId, RestaurantMember
                      ownership guard (403), Zod-validated body, tenant-filtered Prisma.
                      Tools: Read, Edit, Grep, Bash. Model: Sonnet-class.

# target: .claude/agents/module-ui.md
module-ui             Shadcn + TanStack Query CRUD screen builder. RSC-first, optimistic
                      mutations + rollback, dnd-kit/Recharts where relevant.
                      Tools: Read, Edit, Grep, Bash. Model: Sonnet-class.

# target: .claude/agents/ai-engineer.md
ai-engineer           BUILDS src/lib/ai/ — text-to-SQL engine, DMMF-generated schema-context,
                      weekly summary, inventory alerts. Enforces the five defenses
                      (read-only role, read-only txn + timeout + LIMIT, RLS, static pre-filter,
                      generateObject + Zod). Tools: Read, Edit, Grep, Bash. Model: Opus-class.

# target: .claude/agents/sql-safety-reviewer.md
sql-safety-reviewer   READ-ONLY auditor of the text-to-SQL path. Verifies SELECT-only,
                      bound-parameter restaurantId, table allowlist, LIMIT, read-only role;
                      runs adversarial fixtures. Tools: Read, Grep, Bash. Model: Opus-class.

# target: .claude/agents/e2e-playwright.md
e2e-playwright        Playwright E2E author. Auth + tenant-isolation negative test, order
                      pipeline, AI flow (mocked). Stable testids, seeded tenant.
                      Tools: Read, Edit, Bash. Model: Sonnet-class.

# target: .claude/agents/security-reviewer.md
security-reviewer     READ-ONLY cross-cutting auditor. Tenancy leaks, authz gaps, Razorpay
                      signature verification, Better Auth session checks, secret/cron-secret
                      handling. Tools: Read, Grep, Bash. Model: Opus-class.
```

And these under `.claude/commands/` (slash-commands):

```text
# target: .claude/commands/scaffold-module.md
/scaffold-module      Full module vertical slice (schema→route→hooks→UI→nav), then security review.

# target: .claude/commands/add-api-route.md
/add-api-route        One Route Handler with ownership guard + Zod + tenant filter.

# target: .claude/commands/generate-seed-data.md
/generate-seed-data   Idempotent prisma/seed.ts with ~3 months of correlated demo data.

# target: .claude/commands/review-sql-safety.md
/review-sql-safety    Runs the text-to-SQL safety checklist + adversarial fixtures via sql-safety-reviewer.

# target: .claude/commands/new-vertical.md
/new-vertical         Stamps src/lib/verticals/<name>.ts: entity aliases, KPIs, copy, AI schema-context.
```

---

## Appendix: External-API facts these specs depend on

These pin the agents to the *current* (mid-2026) APIs of the swapped-in stack. **All of these change over time — re-verify before you encode them into a file.**

- **Better Auth (replaces Clerk).** Server-side session retrieval is `auth.api.getSession({ headers: await headers() })` from a Server Component / Route Handler. Multi-tenancy maps onto the **Organization plugin** (built-in `owner`/`admin`/`member` roles, invitations, access control) — but this project's schema models tenancy explicitly as `RestaurantMember`, so the ownership guard does an explicit `RestaurantMember` lookup keyed by the session user + URL `restaurantId`. As of late 2025 the Better Auth team took over Auth.js maintenance and it's the recommended path for new Next.js projects. ([Next.js integration](https://better-auth.com/docs/integrations/next), [Organization plugin](https://better-auth.com/docs/plugins/organization))

- **Vercel AI SDK + `@ai-sdk/google` (replaces Anthropic).** Install `ai` + `@ai-sdk/google`; set `GOOGLE_GENERATIVE_AI_API_KEY`. Model handle: `google('gemini-2.5-flash')`. For the **streaming** natural-language step use `streamText(...)` and return `result.toUIMessageStreamResponse()` from the route; the client uses `useChat()` from `@ai-sdk/react`. For the **structured SQL-generation** step use `generateText`/`generateObject` (non-streaming). Note: the project plan's `toAIStreamResponse()` is from an **older AI SDK major** — current SDK (v5/v6 line) uses `toUIMessageStreamResponse()`; confirm against your installed version. ([AI SDK + Gemini](https://ai.google.dev/gemini-api/docs/vercel-ai-sdk-example), [@ai-sdk/google](https://www.npmjs.com/package/@ai-sdk/google), [AI SDK 5](https://vercel.com/blog/ai-sdk-5))

- **Gemini 2.5 Flash free-tier limits (2026, volatile).** Roughly **~10 RPM, ~250 RPD, ~250K TPM** for `gemini-2.5-flash` (and ~15 RPM / ~1,000 RPD for `gemini-2.5-flash-lite`); RPD resets midnight Pacific; limits apply **per Google Cloud project, not per key**, and are tighter than the retiring 2.0 Flash. So the weekly-summary cron iterating over all restaurants must batch/throttle (run it on Flash-Lite) and never assume headroom. **Re-check before relying on any number.** ([Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [free-tier 2026](https://tokenmix.ai/blog/gemini-api-free-tier-limits))

- **Razorpay (replaces Stripe).** Server SDK: `new Razorpay({ key_id, key_secret })`, create an order with `instance.orders.create({ amount, currency, receipt })` (amount in paise). **Verify the checkout signature** with `validatePaymentVerification` and **verify webhooks** with `validateWebhookSignature` (both from `razorpay/dist/utils/razorpay-utils`) before trusting any plan change — this is what `security-reviewer` checks on the payments path. ([Node SDK integration](https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/), [Subscriptions](https://razorpay.com/docs/payments/subscriptions/integration-guide/))
