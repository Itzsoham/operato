# Operato — build status

Where the project actually is, what is left, and what is deliberately deferred.
Last updated after `bb4262d` (Overview dashboard).

The restaurant app **works end to end today**: you can sign up, create a restaurant, build
a menu, take an order through the kitchen to payment, move stock, keep a CRM, and read a
dashboard. What is missing is the AI layer, billing, uploads, the public site, and tests.

---

## Done

Eight modules, each built → reviewed → fixed → verified in a browser → pushed.

| # | Module | Commit | What it does |
|---|--------|--------|--------------|
| 0 | Foundation | `6f690b8` | Prisma 7 schema (19 models), Better Auth, dual DB clients, RLS-backed AI boundary |
| 1 | Seed data | `8b0e1c1` | 2 restaurants, ~6k orders, ~15k line items, 320 customers, 3 months, correlated |
| 2 | Auth + onboarding | `327a570` | Sign up/in/out, Google button, Restaurant+OWNER in one transaction, page guards |
| 3 | Dashboard shell | `30b0616` | Sidebar, restaurant switcher, nav, user menu |
| 4 | Menu | `bdbe8fb` | Categories + dishes, availability, the vertical-slice template |
| 5 | Orders + Tables | `01c3de5` | Floor grid, order → kitchen → payment, row-locked customer rollup |
| 6 | Inventory | `65edcfc` | Signed-delta ledger, row-locked movements, velocity + reorder list |
| 7 | Customers | `7e05f36` | CRM list, order history, phone rule enforced by the database |
| 8 | Overview | `bb4262d` | Revenue trend, top sellers, order mix, KPI tiles, tenant-timezone windows |

**Size:** ~7,700 lines of hand-written TypeScript (excluding generated Prisma client and
shadcn primitives), 25 route files, 8 migrations, 7 unit tests.

### The guarantees, and how they are enforced

Not aspirations — each was verified against the live database, not asserted.

| Guarantee | Mechanism | Proof |
|---|---|---|
| One tenant cannot read another's data | `requireMember` on every route + `restaurantId` from the URL, never the body | Cross-tenant GET/POST both return 403 |
| A cross-tenant *reference* is impossible | Composite FKs pin every child's `restaurantId` to its parent's | An order in A referencing B's table is rejected by Postgres |
| The AI cannot write, or escape its tenant | Read-only role + `default_transaction_read_only` + RLS, fail-closed | `npm run verify:ai-boundary` — 6 checks |
| The AI cannot read PII or credentials | Column-level grants; `account`/`session` revoked | `SELECT *` on `Customer` is denied; "top customers" still answers |
| A bill cannot be settled twice | `SELECT … FOR UPDATE` on the order, then the customer | 8 concurrent pays → 1 settles, spend counted once |
| The client cannot set a price | Server reads price from the menu inside the transaction, snapshots it | Sent `unitPrice: 1` for a ₹320 dish → ₹320 stored |
| Order numbers never collide | Atomic counter (`UPDATE … RETURNING`), not `max()+1` | 20 concurrent orders → 20 unique numbers, 0 failures |
| The stock ledger reconciles | Row-locked movements, signed `delta` column | `SUM(delta) = currentStock` for every item; 30 concurrent moves, 0 breaks |
| A customer is never anonymous-duplicated | `phone` is `NOT NULL` + canonical E.164 | 4 spellings of one number collapse to 1 row |

### Notable bugs caught in review (all fixed)

The ones worth remembering, because they all passed typecheck, lint, and build:

- **The AI could read password hashes.** `GRANT SELECT ON ALL TABLES` swept in Better
  Auth's tables, which have no `restaurantId` for RLS to filter on.
- **A stock-take of −3kg and +3kg were byte-identical rows.** `SUM(quantity)` read a
  shrinkage write-off as a *gain* — and text-to-SQL will write exactly that query.
- **Toggling availability flipped vegetarian dishes to non-vegetarian.** Zod 4's
  `.partial()` does not strip `.default()`.
- **Dark mode had never worked, app-wide.** Nothing mounted the `.dark` class.
- **A table could be marked free with someone sitting at it** — a phantom read; `INSERT`
  takes `FOR KEY SHARE`, which doesn't conflict with a status update.
- **The dashboard's "day" was a UTC day.** 78 orders (₹90,289) filed on the wrong date;
  the whole previous business day vanished during 00:00–05:30 IST close-out.
- **`serialize()` looked right and did nothing.** `JSON.stringify` calls `toJSON()` before
  the replacer, so every price reached the browser as `"480"` instead of `480`.

---

## Left to build

Ordered by what unblocks the most. The first three are the product's actual thesis.

### 1. Playwright E2E — deferred mid-step, resume here

`playwright.config.ts` **does not exist**, so `npm run test:e2e` fails today. Chromium is
already installed and the browser-driving pattern is proven (every module was verified this
way). Needs:

- `playwright.config.ts` + a `tests/e2e/` directory
- **The tenant-isolation negative test** — a member of A gets 403/404 on B. This is the
  single most valuable spec in the project; it guards the guarantee everything rests on.
- Order create → kitchen → pay happy path.
- Auth: sign up → onboarding → dashboard.

### 2. The AI layer (`src/lib/ai/` — does not exist yet)

The reason the project exists. The **security boundary is already built and verified**;
what is missing is the engine on top of it.

| Feature | State | Notes |
|---|---|---|
| Text-to-SQL assistant | Not started | `AiQuery` model exists. Needs `generateObject` + Zod for the SQL step (never `JSON.parse` model text), the read-only transaction wrapper, forced `LIMIT`, static rejection pre-filter. `getAiPrisma()` and `assertAiRoleIsSafe()` are ready. |
| `schema-context.ts` | Not started | Must be **generated from the Prisma DMMF**, not hand-written, or it drifts from the schema silently. Must list only the columns the AI role can actually read (the `Customer` grant is column-level). |
| Weekly summary cron | Not started | `WeeklySummary` model exists. `vercel.json` **does not** — no cron wiring at all. Needs throttling: the free-tier Gemini key has a tight RPM and the naive loop over all tenants will rate-limit. |
| Smart inventory alerts | **Half done, deliberately** | The velocity math (`daysLeft`, `dailyUsage`, reorder list) is built and is *arithmetic, not an AI call* — "how many days of chicken" has an exact answer. Only the LLM prose layer is missing, and it is the least valuable part. |

Gate every change here behind `/review-sql-safety` — the repo has a `sql-safety-reviewer`
agent for exactly this.

### 3. Razorpay billing

`ProcessedWebhook` (with the unique `eventId` for idempotency) exists. Nothing else does.

- Checkout flow + `/api/webhooks/razorpay`
- **Verify the HMAC signature over the raw body** (`await req.text()` — do not let it be
  JSON-parsed first)
- Idempotency on `x-razorpay-event-id`; handle out-of-order delivery
- Only grant `PRO` from `subscription.activated`/`charged`, never from the client handler
- A reconciliation job for missed webhooks
- Env: `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PRO_PLAN_ID` are unset

### 4. Uploadthing (menu images)

`MenuItem.image` exists and the Zod schema **already pins it to https + the uploader's
host** (a bare `z.url()` accepts `javascript:` and the cloud metadata IP). Needs the
provider wired and an upload control in the menu dialog. `UPLOADTHING_TOKEN` unset.

The plan's own review suggests this is the first thing to cut if time is short — a text URL
input ships in minutes.

### 5. Public marketing site — `src/app/(marketing)/`

Landing + pricing, static, SEO'd, no auth. Fully specced in the plan (wireframe and
section-by-section copy). Nothing built.

### 6. Staff & Shifts — schema only, deliberately deferred

`Staff` and `Shift` models exist and are correct (including the denormalized
`restaurantId`). No routes, no UI, not in the nav. The plan's own code review names this as
the first module to cut: lowest value, and the AI only loses the "who worked the most
hours" example. **Resume only if the rest is done.**

### 7. Deploy

Never deployed. Needs a Vercel project, the env vars set, `vercel.json` for the cron, and
`BETTER_AUTH_URL` pointed at the real origin.

---

## Known issues and debt

Real, understood, and not yet fixed. None of these block local development.

### Security / correctness

| Issue | Impact | Fix |
|---|---|---|
| **Better Auth rate limiter is in-memory** | On serverless this is per-lambda and resets on cold start, so sign-in is effectively open to credential stuffing | Give it `secondaryStorage` (Redis/Upstash) before real traffic |
| **Email verification not required** | Anyone can register any address. Becomes an account-takeover primitive the day team-invite-by-email ships | `requireEmailVerification: true` + a send hook |
| **`Restaurant.timezone` is only read by the analytics module** | Inventory velocity and any future cron/AI date filter still compute UTC days — the same bug that misfiled 78 orders | Thread `timezone` through anywhere a "day" is computed |
| **The `Decimal`-not-`string` annotation is still wrong in two files** | `src/lib/inventory/service.ts` and `src/lib/orders/service.ts` type `$queryRaw` numerics as `string`; they are Decimal objects. Works only because `Number()` coerces | Fix the type; `overview.ts` has the correct version |
| **No reconciliation job for the CRM rollup** | Nothing stops a future `customer.update({ totalSpend })` from corrupting it | Add a check to the weekly cron |
| **`npm audit`: 6 moderate** | `postcss` XSS via `next`'s transitive dep — build-time only, not in the request path | Wait for the upstream bump. **Do not** `audit fix --force` (it downgrades to `next@9`) |

### Product / UX

- **No theme toggle.** `next-themes` is mounted with `defaultTheme="system"`, so OS-dark
  users get the dark UI with no way to opt out. Needs a switcher in the user menu.
- **No item-management UI in Inventory.** The API supports create/edit/delete; the client
  only records movements. `useCreateInventoryItem` is written but never mounted.
- **No category-management UI in Menu.** Same shape — the API is complete, the UI isn't.
- **Order history has no date filter or pagination.** Capped at 50, newest first.

### Setup

- **Rotate the Neon password and the Google client secret** — both were pasted in chat.
- **Register the Google OAuth redirect URI**: `http://localhost:3000/api/auth/callback/google`
  (and the prod origin later), or the Google button 400s.
- **Unset env vars**: `GOOGLE_GENERATIVE_AI_API_KEY`, `RAZORPAY_*`, `UPLOADTHING_TOKEN`,
  `CRON_SECRET`. Everything else is set and working.

---

## Suggested order

1. **Playwright E2E** — the isolation spec, while the tenancy design is fresh.
2. **Text-to-SQL** — the thesis. The dangerous half is already built and verified.
3. **Weekly summary cron** — needs `vercel.json` and throttling.
4. **Marketing site** — cheap, fully specced, and the first thing anyone sees.
5. **Razorpay** — the riskiest integration; the app is fully usable on FREE without it.
6. **Uploadthing**, then **Staff & Shifts** — both genuinely optional.

## Commands

```bash
npm run dev                  # dev server (Turbopack)
npm run typecheck            # tsc --noEmit
npm run lint                 # eslint (NOT `next lint` — removed in Next 16)
npm test                     # vitest — the validation guards
npm run db:seed              # rebuild demo data (idempotent; SEED_NOW pins the clock)
npm run verify:ai-boundary   # prove the AI role still can't write/escape/read PII
npm run build                # production build
```

**Demo logins** (password `operato-demo-1234`): `owner@spicegarden.test`,
`owner@dailygrind.test`.

> Re-run `npm run db:seed` if the dashboard looks quiet — the seed generates data relative
> to *when it ran*, so a stale seed shows a revenue cliff at the right edge of the trend.
