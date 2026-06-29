# Operato Plan — Adversarial Engineering Review

> Reviewing `operato_project_plan.html` as a **design doc**, not running code. Findings target the design and the code samples it contains. Target stack is **Better Auth** (replaces Clerk), **Razorpay** (replaces Stripe), **Google Gemini via the Vercel AI SDK** (replaces Anthropic Claude). Note: the plan's HTML body still names Clerk/Stripe/Anthropic throughout — that copy is now stale and every code sample (`anthropic.messages.create`, `claude-sonnet-4-6`, `stripeCustomerId`, `clerkUserId`, `webhooks/clerk`, `webhooks/stripe`) must be rewritten before it is implemented.

> **Status (applied):** The schema-relation and tenancy/safety fixes in this review have since been applied to `operato_project_plan.html` (Database, AI Features, and architecture-notes sections), and the docs reflect the Better Auth / Razorpay / Gemini 2.5 stack. This document remains the rationale for *why* each change was made.

## Verdict

The plan is a strong *product/story* document but a weak *engineering* one: the headline feature (an AI that runs SQL against the tenant's real database) is described with a security model that does not hold, and the Prisma schema that everything depends on **will not `prisma generate`** as written. At least three relations are one-sided and one relation field is outright mis-typed (`restaurant RestaurantTable?` on `Order`). The multi-tenant safety story ("`restaurantId` is always injected as a param") is contradicted by the schema itself, because three of the tables the AI will query (`Shift`, `InventoryTransaction`, `OrderItem`) carry no `restaurantId` column at all. The text-to-SQL execution sample is both syntactically invalid (`Prisma.sql([sql], ...)`) and unsafe (a `startsWith('SELECT')` check is not a sandbox). Auth is asserted to be handled "once in `layout.tsx`," which does nothing for `/api` route handlers. None of this is fatal to the project, but all of it must be fixed *before* writing code, because the schema and the tenancy model are load-bearing for every module and every AI feature.

### Top 5 must-fix before writing code

1. **Fix the Prisma schema relations** — add the missing back-relations (`Order.restaurant`, `Order.customer`, `Shift.staff`) and rename the mis-typed `Order.restaurant RestaurantTable?` to `Order.table`. As written, `prisma validate` fails and nothing downstream exists. *(Critical — Finding 1)*
2. **Make tenancy enforceable, not advisory** — denormalize `restaurantId` onto `OrderItem`, `InventoryTransaction`, and `Shift` (indexed), AND enforce isolation with Postgres Row-Level Security so a missing/wrong `WHERE` clause from the model cannot cross tenants. *(Critical — Findings 2 + 3)*
3. **Replace the text-to-SQL execution path** — a dedicated read-only Postgres role + read-only transaction + `statement_timeout` + forced `LIMIT` + reject `;`/comments, plus `generateObject` (Zod) for the SQL step. The current sample is invalid and unsafe. *(Critical — Finding 3)*
4. **Protect every API route independently** — add a `requireMember(restaurantId)` Better Auth helper called at the top of every handler under `/api/restaurants/[restaurantId]`. `layout.tsx` does not run for route handlers. *(Critical — Finding 6)*
5. **Pin the Gemini model + quota plan** — `gemini-2.0-flash` is on the deprecation path, so the stack now pins **`gemini-2.5-flash`** (interactive) and **`gemini-2.5-flash-lite`** (the cron); add per-tenant throttling so the weekly-summary cron and one noisy tenant cannot exhaust the shared free-tier quota — whose 2.5 RPD ceiling is **lower** than 2.0's was. *(High — Findings 5 + 7)*

---

## Findings by severity

| # | Title | Severity | Area |
|---|-------|----------|------|
| 1 | Prisma schema will not generate — broken relations | Critical | Schema |
| 2 | Tenancy gap: tables with no `restaurantId` can't be filtered | Critical | Multi-tenant / AI |
| 3 | Text-to-SQL execution is invalid Prisma and unsafe | Critical | AI / Security |
| 6 | API routes are unprotected (`layout.tsx` ≠ route handlers) | Critical | Auth |
| 5 | BigInt/Decimal serialization breaks `JSON.stringify(data)` | High | AI / Correctness |
| 7 | Gemini quota: shared free-tier key + cron loop will rate-limit | High | AI / Ops |
| 8 | Inventory writes need a transaction + row lock | High | Data integrity |
| 11 | No Razorpay webhook idempotency / reconciliation | High | Payments |
| 4 | `JSON.parse(content.text)` is brittle — use structured output | Medium | AI |
| 9 | Customer `[restaurantId, phone]` unique with NULL phone | Medium | Schema / CRM |
| 10 | `schema-context.ts` drifts from the real schema | Medium | AI / Maintenance |
| 12 | Timeline is optimistic; underestimated items called out | Medium | Planning |

---

### Finding 1 — Prisma schema will not generate: broken/one-sided relations

- **Severity:** Critical
- **Area:** Prisma schema integrity

**Problem.** Several relations are declared on only one side, and one relation field is pointed at the wrong model:

| Declared on | Field | Problem |
|---|---|---|
| `Restaurant` | `orders Order[]` | `Order` has **no** `restaurant Restaurant @relation(fields:[restaurantId]...)` back-relation. |
| `Order` | `restaurant RestaurantTable? @relation(fields:[tableId], references:[id])` | The field is **named `restaurant` but typed `RestaurantTable`** — it is the table link, mislabeled. Also the actual `Order → Restaurant` link is missing entirely. |
| `Customer` | `orders Order[]` | `Order` has a scalar `customerId String?` but **no** `customer Customer @relation` field. |
| `Staff` | `shifts Shift[]` | `Shift` has a scalar `staffId String` but **no** `staff Staff @relation` field, and no `restaurantId`. |

Confirmed *not* broken: `MenuCategory ↔ MenuItem`, `Order ↔ OrderItem`, `InventoryItem ↔ InventoryTransaction`, and the `MenuItem ↔ InventoryItem` 1:1 (`InventoryItem.menuItemId String? @unique` + both sides present) are all valid.

**Why it matters.** `prisma validate` / `prisma generate` **fails** on a list field whose target model has no matching relation field ("missing an opposite relation field"). The build does not compile; no client, no migration, nothing downstream. This blocks 100% of the project from day one.

**Fix.** Add the missing relation fields and rename the mislabeled one. `RestaurantTable.orders` already exists, so `Order` needs both a real `restaurant` and a renamed `table`:

```prisma
// prisma/schema.prisma

model Order {
  id           String      @id @default(cuid())
  restaurantId String
  orderNumber  String
  tableId      String?
  customerId   String?
  // ... unchanged scalar fields ...

  // FIX: real tenant relation (was missing) — back-relates Restaurant.orders
  restaurant Restaurant       @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  // FIX: was `restaurant RestaurantTable?` — renamed to `table`, back-relates RestaurantTable.orders
  table      RestaurantTable? @relation(fields: [tableId], references: [id])
  // FIX: was missing — back-relates Customer.orders
  customer   Customer?        @relation(fields: [customerId], references: [id])
  orderItems OrderItem[]

  @@index([restaurantId, status])
  @@index([restaurantId, createdAt])
}

model Shift {
  id          String    @id @default(cuid())
  staffId     String
  restaurantId String   // FIX: denormalized tenant key (see Finding 2)
  startTime   DateTime
  endTime     DateTime?
  hoursWorked Decimal?  @db.Decimal(5,2)
  notes       String?
  createdAt   DateTime  @default(now())

  // FIX: was missing — back-relates Staff.shifts
  staff       Staff      @relation(fields: [staffId], references: [id], onDelete: Cascade)
  restaurant  Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  @@index([restaurantId, startTime])
}
```

> Note: adding `restaurant Restaurant @relation` on `Shift`, `OrderItem`, and `InventoryTransaction` also requires the matching back-relation arrays on `Restaurant` (`shifts Shift[]` etc.) or named relations — wire both sides.

---

### Finding 2 — Tenancy gap: `Shift`, `InventoryTransaction`, `OrderItem` have no `restaurantId`

- **Severity:** Critical
- **Area:** Multi-tenant isolation / AI

**Problem.** The AI safety story is *"`restaurantId` is always injected as a parameter"* (plan AI-flow step 4, interview answer #3). But three tables that the AI must read have **no `restaurantId` column**:

- `OrderItem` (line plan: only `orderId`, `menuItemId`, …) — needed for "which items sold most", top-items, AOV.
- `InventoryTransaction` (only `inventoryItemId`) — needed for stock movement / velocity queries.
- `Shift` (only `staffId`) — needed for "who worked the most hours."

So a generated query like *"top items this week"* must `JOIN OrderItem → Order` to reach `Order.restaurantId`. The "just inject `restaurantId`" model **cannot apply a `WHERE restaurantId = $1`** to these tables — there is no such column. If the model forgets the join (or joins wrong), it reads **every tenant's** order items. The simple safety story silently does not cover the exact tables the marquee queries touch.

**Why it matters.** This is a cross-tenant data-leak surface on the headline feature. It is not theoretical: text-to-SQL frequently omits or mis-scopes joins, and these three tables are precisely the ones the example queries hit.

**Fix (do both).**

1. **Denormalize `restaurantId` onto the leaf tables and index it**, so a flat `WHERE restaurantId = $1` is always available and the AI never depends on a correct join for isolation:

```prisma
// prisma/schema.prisma
model OrderItem {
  // ... existing fields ...
  restaurantId String        // FIX: denormalized for direct tenant filtering
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  @@index([restaurantId])
}

model InventoryTransaction {
  // ... existing fields ...
  restaurantId String        // FIX
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  @@index([restaurantId, createdAt])
}
// Shift gets restaurantId too — see Finding 1 snippet.
```

Application code must set `restaurantId` on every insert (a Prisma `$extends` query extension or a service-layer guard keeps it from drifting from the parent).

2. **Do not trust the `WHERE` clause at all — enforce Postgres Row-Level Security.** This is the real fix; denormalization just makes the RLS policy a one-liner per table:

```sql
-- prisma/migrations/xxxx_rls/migration.sql
ALTER TABLE "Order"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shift"                ENABLE ROW LEVEL SECURITY;
-- ... and every tenant table ...

CREATE POLICY tenant_isolation ON "OrderItem"
  USING ("restaurantId" = current_setting('app.restaurant_id', true));
```

The read-only AI connection runs `SET LOCAL app.restaurant_id = $1` inside the transaction (Finding 3). With RLS on, even a `SELECT * FROM "OrderItem"` with no `WHERE` returns only the active tenant's rows — the model *cannot* leak across tenants even if it omits the filter entirely. RLS is the only mechanism here that is robust to an LLM writing the query.

---

### Finding 3 — Text-to-SQL execution is invalid Prisma and fundamentally unsafe

- **Severity:** Critical
- **Area:** AI / Security

**Problem.** The execution sample:

```ts
// app/api/restaurants/[id]/ai/query/route.ts  (AS WRITTEN — broken & unsafe)
if (!sql.trim().toUpperCase().startsWith('SELECT')) { /* reject */ }
const data = await prisma.$queryRaw(
  Prisma.sql([sql], restaurantId, ...sqlParams)   // not valid usage
)
```

Two classes of problem:

**(a) It does not run.** `Prisma.sql` is a *tagged-template* helper; `Prisma.sql([sql], restaurantId, ...)` is not how you build a query from a model-produced string. And `$queryRaw` is itself a tagged template — passing a plain string interpolates it as **raw, unparameterized SQL** (`$queryRawUnsafe` territory), which is the injection footgun. There is no construct here that safely binds a *dynamic* SQL string with a variable number of params.

**(b) The validation is security theater.** `startsWith('SELECT')` is bypassed or defeated by, at minimum:

- **Stacked statements:** `SELECT 1; DROP TABLE "Order"; --` (still "starts with SELECT").
- **CTEs that write:** `WITH x AS (DELETE FROM ... RETURNING *) SELECT * FROM x` — Postgres allows data-modifying CTEs.
- **Comment / whitespace tricks:** leading `/* */`, newlines, `(SELECT ...)`.
- **Expensive queries:** unbounded cross joins, `pg_sleep()`, reading `pg_catalog`/`information_schema`, no `LIMIT`, no timeout → DoS on the shared DB.
- **No tenant guarantee:** "whitelist table names" + "inject `restaurantId`" does nothing for the columnless tables in Finding 2.

**Why it matters.** This is arbitrary model-authored SQL executed against the production multi-tenant database. A prompt-injected or simply mistaken query can delete data or read another tenant's books. This is the single highest-risk component in the plan.

**Fix.** Defense in depth — the WHERE clause is the *last* line, not the only one:

1. **Dedicated read-only role + connection.** The AI never uses the app's read-write client.

```sql
CREATE ROLE operato_ai_readonly NOLOGIN;
GRANT USAGE ON SCHEMA public TO operato_ai_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO operato_ai_readonly;
-- explicitly no INSERT/UPDATE/DELETE/DDL; future tables default to no grant
```

Use a second `DATABASE_URL_AI` pointing at this role (separate `PrismaClient`).

2. **Read-only transaction + timeout + tenant GUC + forced LIMIT.**

```ts
// src/lib/ai/run-readonly-sql.ts
export async function runReadonlySql(restaurantId: string, sql: string, params: unknown[]) {
  return aiPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '5s'`);
    await tx.$executeRawUnsafe(`SET LOCAL transaction_read_only = on`);
    // drives the RLS policy from Finding 2:
    await tx.$executeRawUnsafe(`SET LOCAL app.restaurant_id = $1`, restaurantId);
    const wrapped = `SELECT * FROM ( ${sql} ) AS _q LIMIT 1000`;
    return tx.$queryRawUnsafe(wrapped, ...params);
  });
}
```

`SET LOCAL transaction_read_only = on` makes any write attempt (including data-modifying CTEs) error at the DB layer regardless of what the model produced.

3. **Static rejection BEFORE execution** (cheap pre-filter, not the security boundary): reject if the string contains `;`, `--`, `/*`, or matches `\b(insert|update|delete|drop|alter|create|grant|truncate|copy|pg_sleep|pg_read|information_schema|pg_catalog)\b`; require it to parse as a single `SELECT`.

4. **RLS (Finding 2) is the actual tenant guarantee** — with `transaction_read_only` + RLS + read-only role, even a malformed model query is contained.

> The marketed interview claim "even if Claude generated a technically valid query, it can only ever read data for the authenticated restaurant" is **only true once RLS exists** — today's design does not deliver it.

---

### Finding 6 — API route handlers are unprotected (`layout.tsx` ≠ route handlers)

- **Severity:** Critical
- **Area:** Auth (Better Auth)

**Problem.** The plan states (File Structure → Key architecture notes): *"ownership check happens once in `layout.tsx`, not repeated per route."* React Server Component `layout.tsx` files run only for the **page** segment tree. They **do not execute for Route Handlers** under `app/api/**`. So every endpoint in `app/api/restaurants/[restaurantId]/{menu,orders,inventory,customers,staff,ai}/route.ts` is reachable by **any authenticated user for any `restaurantId`** — the entire write/read API is unauthorized as designed.

**Why it matters.** A logged-in user of restaurant A can `POST /api/restaurants/<B>/orders` or hit `/ai/query` for tenant B. With Better Auth there is no Clerk-style middleware magic doing this for you; membership must be checked explicitly in each handler.

**Fix.** A shared `requireMember` helper, called at the top of **every** route handler (and reused by Server Actions / page loaders):

```ts
// src/lib/auth/require-member.ts
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function requireMember(restaurantId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Response("Unauthorized", { status: 401 });

  // Better Auth: verify membership in THIS org/restaurant explicitly.
  const member = await auth.api.getActiveMember({ headers: await headers() });
  if (!member || member.organizationId !== restaurantId) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { userId: session.user.id, role: member.role };
}
```

```ts
// src/app/api/restaurants/[restaurantId]/orders/route.ts
export async function POST(req: Request, { params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const { userId } = await requireMember(restaurantId); // <-- every route, no exceptions
  // ...
}
```

> Map the plan's `RestaurantMember`/`clerkUserId` to Better Auth's organization `member` table. If you don't adopt the organization plugin, keep `RestaurantMember` and query it directly with `session.user.id` instead of `clerkUserId`. Also note Better Auth's `get-full-organization` exposes the full member list to any member by default — restrict it if members are end-customers.

---

### Finding 5 — `JSON.stringify(data)` breaks on `BigInt`/`Decimal` from `$queryRaw`

- **Severity:** High
- **Area:** AI / correctness

**Problem.** `prisma.$queryRaw` returns raw driver types, **not** Prisma's mapped types: aggregates like `COUNT(*)`/`SUM()` come back as `BigInt`, and `numeric`/`Decimal(10,2)` columns come back as `Decimal` objects (or strings depending on driver). The plan then does:

```ts
prompt: `Data: ${JSON.stringify(data)} ...`
```

`JSON.stringify` on a `BigInt` throws `TypeError: Do not know how to serialize a BigInt`. Every AI query that sums revenue or counts orders — i.e. essentially all of them — crashes at the serialization step.

**Why it matters.** The text-to-SQL feature fails on its own canonical examples ("average order value", "top customers by spend", "items sold most").

**Fix.** Serialize results through a normalizer before they reach the prompt:

```ts
// src/lib/ai/serialize.ts
import { Prisma } from "@prisma/client";
export function serializeRows(rows: unknown): unknown {
  return JSON.parse(JSON.stringify(rows, (_k, v) => {
    if (typeof v === "bigint") return Number(v);
    if (v instanceof Prisma.Decimal) return v.toNumber();
    return v;
  }));
}
// usage: prompt: `Data: ${JSON.stringify(serializeRows(data))} ...`
```

(For money, prefer `.toString()`/fixed precision over `Number()` to avoid float drift in what the LLM reports.)

---

### Finding 7 — Gemini free-tier quota: shared key + cron loop will rate-limit; cron may time out

- **Severity:** High
- **Area:** AI / Ops

**Problem.** Two interacting issues with the Gemini swap:

1. **Shared free-tier quota.** Gemini's free tier enforces tight **per-minute (RPM)**, **per-day (RPD)**, and **TPM** caps on a single project/API key — and Google has *cut* these limits repeatedly (Flash-class free RPD has been reported as low as the low hundreds, even ~20/day at times after the Dec-2025 reductions). The weekly-summary cron does `prisma.restaurant.findMany()` then a `generateText` per restaurant **in a tight loop** on one shared key. Past ~10–15 tenants you hit the RPM wall; across a day, one chatty tenant's interactive AI queries can exhaust the **shared RPD** for *every* tenant. There is no per-tenant accounting.
2. **Cron execution-duration ceiling.** Vercel functions have a max execution duration (Hobby is short; even Pro caps out), and Gemini latency is seconds per call. A serial loop over many restaurants will **time out mid-run**, leaving some tenants without a summary and no retry.

> Limits change frequently and depend on tier/account — pin the exact current numbers from Google AI Studio's rate-limit page at build time rather than hard-coding assumptions.

**Why it matters.** The "no setup required, every Monday" promise silently breaks for most tenants, and a single tenant can deny AI service to all others.

**Fix.**

- **Pin a supported model.** `gemini-2.0-flash` is on the deprecation path — the stack now targets **`gemini-2.5-flash`** (interactive) and **`gemini-2.5-flash-lite`** (the high-volume cron) via `@ai-sdk/google`, centralized in one constant so future swaps are one line. Note 2.5's free RPD is tighter than 2.0's, so the throttle + per-tenant cap matter more, not less.
- **Throttle the cron:** process in **chunks** with a concurrency limit (e.g. `p-limit` of 1–2) and a small inter-call delay to stay under RPM; or fan out one tenant per invocation via a queue (Inngest/QStash) so each summary is its own retried job — the plan's own interview answer already concedes "Cron doesn't retry failed jobs reliably."
- **Per-tenant rate limits** on the interactive `/ai/query` endpoint (e.g. N/day/tenant, tracked in `AiQuery` or Redis) so one tenant can't drain the shared quota.
- Consider a **paid tier / billing-enabled key** before any real multi-tenant traffic; free tier is fine for a demo with a handful of seeded tenants but not for the "loop over ALL restaurants" design.

---

### Finding 8 — Inventory write integrity: `balanceAfter` + `currentStock` need one transaction with a row lock

- **Severity:** High
- **Area:** Data integrity

**Problem.** `InventoryTransaction.balanceAfter` and `InventoryItem.currentStock` are two denormalized copies of the same truth. The plan never mentions wrapping the read-modify-write in a transaction or locking the row. Two concurrent stock moves (a stock-in and an order-driven stock-out) interleave as: both read `currentStock = 10`, both compute and write `balanceAfter`, last write wins → stock is wrong and the audit trail (`balanceAfter`) is internally inconsistent. For an "audit trail" feature, a corrupt trail defeats the purpose.

**Why it matters.** Inventory is also the input to the velocity/alerts AI feature; bad balances produce wrong reorder advice. Restaurants do have concurrent activity (kitchen + counter).

**Fix.** Single `prisma.$transaction` with a `SELECT ... FOR UPDATE` row lock so concurrent moves serialize:

```ts
// src/lib/inventory/apply-movement.ts
await prisma.$transaction(async (tx) => {
  const [item] = await tx.$queryRaw<{ currentStock: Prisma.Decimal }[]>`
    SELECT "currentStock" FROM "InventoryItem"
    WHERE id = ${itemId} FOR UPDATE`;                 // lock the row
  const balanceAfter = item.currentStock.plus(delta); // delta signed by type
  await tx.inventoryItem.update({ where: { id: itemId }, data: { currentStock: balanceAfter } });
  await tx.inventoryTransaction.create({
    data: { inventoryItemId: itemId, restaurantId, type, quantity: delta.abs(), balanceAfter },
  });
});
```

The same pattern applies to the "on payment, update `Customer.totalSpend`/`visitCount`" step (plan Module 2) — wrap that in a transaction too.

---

### Finding 11 — No Razorpay webhook idempotency or reconciliation

- **Severity:** High
- **Area:** Payments

**Problem.** The plan has `api/webhooks/stripe/route.ts` "Plan changes" with no mention of signature verification, **idempotency**, ordering, or reconciliation. Razorpay (the new processor) explicitly states it may deliver the **same event multiple times** and **out of order**, and it **retries non-2xx responses with backoff for 24h**. Without idempotency, a redelivered `subscription.charged`/`payment.captured` double-applies; a webhook missed entirely (your endpoint down) leaves `plan`/`planExpiresAt` permanently wrong with no backstop.

**Why it matters.** Billing state divergence = users paying but on FREE, or churned users still on PRO. This is the kind of bug that erodes trust in a "real SaaS revenue flow."

**Fix.**

- **Verify the signature over the raw body** (`X-Razorpay-Signature` = HMAC-SHA256 of the *unparsed* body with the webhook secret; compare in constant time). In Next.js, read `await req.text()` — do not let the body be JSON-parsed first.
- **Idempotency:** persist the `x-razorpay-event-id` (unique per event) in a `ProcessedWebhook` table with a unique constraint; on duplicate, ack `200` and skip. Handle events out of order (don't assume `authorized` precedes `captured`).
- **Reconciliation:** a scheduled job (or on dashboard load) calls Razorpay's API for the subscription's real status and repairs `plan`/`planExpiresAt`, covering missed webhooks.
- Schema rename: `stripeCustomerId` → `razorpayCustomerId`/`razorpaySubscriptionId`; rename `webhooks/stripe` → `webhooks/razorpay`. The `webhooks/clerk` route is moot under Better Auth (no external user-sync webhook needed — Better Auth owns the user table directly).

```ts
// src/app/api/webhooks/razorpay/route.ts
export async function POST(req: Request) {
  const raw = await req.text();                                   // RAW body
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
                         .update(raw).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return new Response("bad sig", { status: 400 });
  const eventId = req.headers.get("x-razorpay-event-id")!;
  try { await prisma.processedWebhook.create({ data: { eventId } }); }
  catch { return new Response("dup", { status: 200 }); }          // already processed
  // ... apply plan change idempotently ...
  return new Response("ok", { status: 200 });
}
```

---

### Finding 4 — `JSON.parse(sqlRes.content[0].text)` is brittle; use structured output

- **Severity:** Medium
- **Area:** AI

**Problem.** The SQL-generation step parses free-form model text as JSON: `const { sql, sqlParams } = JSON.parse(sqlRes.content[0].text)`. LLMs wrap JSON in prose or markdown fences, emit trailing commas, or hallucinate the shape — `JSON.parse` throws and the feature dies on otherwise valid questions.

**Why it matters.** Reliability of the headline feature; also `content[0].text` is Anthropic's response shape, which doesn't exist under the Gemini/AI-SDK swap anyway.

**Fix.** Use the Vercel AI SDK `generateObject` with a Zod schema (works with `@ai-sdk/google`); the SDK enforces and parses the shape. (The Gemini swap forces this rewrite regardless — call it out so it isn't missed.)

```ts
// src/lib/ai/text-to-sql.ts
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

const { object } = await generateObject({
  model: google("gemini-2.5-flash"),            // pin current model (Finding 7)
  schema: z.object({ sql: z.string(), params: z.array(z.union([z.string(), z.number()])) }),
  system: schemaContext + SAFETY_RULES,
  prompt: query,
});
// object.sql / object.params are typed and validated — no JSON.parse, no content[0].text
```

---

### Finding 9 — `Customer @@unique([restaurantId, phone])` with optional `phone`

- **Severity:** Medium
- **Area:** Schema / CRM

**Problem.** `phone String?` is nullable but is half of the uniqueness key, and Module 4 says profiles are "auto-created on first order (phone as unique key)." In Postgres, **NULLs are distinct** in a unique index, so any number of customers with `phone = NULL` are all allowed — every anonymous/takeaway order creates a **new duplicate** "anonymous" customer, inflating `visitCount`/customer counts and polluting the very CRM data the AI reports on. Conversely the plan's intended "upsert by phone" logic has nothing to upsert against when phone is absent.

**Why it matters.** Walk-in/takeaway orders without a phone are common; the CRM and "new customers" metric silently fill with junk.

**Fix.** Decide and encode the behavior:

- **Don't auto-create a Customer when `phone` is null** — attach the order to no customer (`customerId = null`) and only create/link a profile when a phone (or email) is provided. This is the cleanest.
- If anonymous profiles are wanted, give them a real key (e.g. require phone, or key on a generated token), not NULL.
- Consider a partial unique index to make intent explicit:

```sql
-- only enforce uniqueness when phone is present
CREATE UNIQUE INDEX customer_restaurant_phone
  ON "Customer" ("restaurantId", phone) WHERE phone IS NOT NULL;
```

Either way, the "upsert customer on paid order" code (Module 2) must branch on phone presence.

---

### Finding 10 — `schema-context.ts` is hand-maintained and will drift

- **Severity:** Medium
- **Area:** AI / maintenance

**Problem.** `lib/ai/schema-context.ts` is a hand-written natural-language description of the DB fed to the model. The moment a migration adds/renames a column (and this plan will migrate often), the description goes stale; the AI then generates SQL against columns that no longer exist (errors) or misses new ones (wrong answers). It is also presented as the per-vertical seam, which makes accuracy doubly important.

**Why it matters.** Silent correctness rot on the feature that defines the project, with no compile-time signal.

**Fix.** **Generate** the context from Prisma's DMMF (or `prisma generate` hook) so it can't drift, then layer hand-written *example query pairs* on top:

```ts
// scripts/build-schema-context.ts  (run in `prisma generate` / CI)
import { Prisma } from "@prisma/client";
const lines = Prisma.dmmf.datamodel.models.map(m =>
  `Table ${m.name}: ${m.fields.filter(f => f.kind === "scalar")
    .map(f => `${f.name} (${f.type})`).join(", ")}`);
// emit src/lib/ai/schema-context.generated.ts; keep curated example Q→SQL pairs separate
```

Keep the curated per-vertical examples in a separate file so regeneration never clobbers them. This also keeps the "AI never sees the raw schema" architecture claim honest.

---

### Finding 12 — Timeline realism

- **Severity:** Medium
- **Area:** Planning

The schedule (solo dev, ~3 months June→Sept) packs **5 CRUD modules + 3 AI features + Better Auth + Razorpay + Playwright + landing + seed data + deploy**. That is aggressive but not impossible — *if* the hard parts aren't underestimated. They are:

**Most underestimated items (each is bigger than its slot):**

| Plan slot | Reality |
|---|---|
| Aug Wk1: "Text-to-SQL … test 20+ questions" | The **safety layer** (RLS, read-only role, serialization, validation — Findings 2/3/5) is a week on its own, *before* prompt-tuning. First-time text-to-SQL safety is the single most underestimated task. |
| Aug Wk2: "Vercel Cron + summary" | Quota/throttling/chunking + retries (Finding 7) turn this from an afternoon into days. |
| Aug Wk4: "Razorpay subscription flow" | Webhooks + idempotency + reconciliation (Finding 11), plus Razorpay's India-specific subscription quirks, first-time. Easily a week. |
| Jul Wk4: "comprehensive seed.ts, 3 months realistic data" | Believable, correlated demo data (so the AI has something to say) is genuinely hard and slow; underbudgeted at a few days. |
| June: "Better Auth + onboarding + member sync" | New auth library (not the Clerk the body assumes) + org/member modeling. Budget extra ramp-up. |

**What to cut / scope down if behind (in order):**

1. **Defer Staff & Shifts entirely.** Lowest-value module, and it's the one missing `restaurantId`/relations anyway. Drop it from v1; the AI loses only the "who worked most hours" example.
2. **Drop Uploadthing; accept image **URLs**.** `image String?` already takes a URL — a text input ships in minutes vs. wiring an upload provider. Add Uploadthing post-launch.
3. **Cut AI feature #3 (smart inventory alerts) to a non-AI rule.** The velocity math (`daysLeft`, `weeklyUsage`) is the valuable part and needs no LLM call — render it as a sorted table; skip the `generateText` reorder prose. Saves quota and time.
4. **Trim example AI queries** from "20+" to the 5–6 that actually demo well; over-tuning prompts is a time sink.
5. **Razorpay last, behind a flag.** Ship the app fully functional on FREE only; gate PRO behind a stub. Billing is impressive but not required to demo the AI thesis, and it's the riskiest integration.
6. **Playwright: keep one spec** (the AI-query happy path) rather than auth+orders+ai; it's the spec that proves the headline feature.

This protects the two things the whole pitch rests on — **the AI talking to real tenant data, safely**, and **a believable seeded demo** — while shedding the modules and integrations that add timeline risk without adding to the core story.

---

## Timeline realism + what to cut if behind (summary)

- **Keep, no matter what:** schema correctness (Finding 1), tenant isolation via RLS (Findings 2–3), per-route auth (Finding 6), serialization (Finding 5), and rich seed data. These are non-negotiable for a working, safe demo.
- **Cut first if behind:** Staff/Shifts → defer; Uploadthing → URL input; inventory-alert LLM prose → rule-based table; Razorpay → feature-flag for last; trim AI examples and Playwright specs.
- **External APIs move:** Gemini free-tier limits and model availability (model retirement — the docs now pin `gemini-2.5-flash`), Better Auth's organization API surface, and Razorpay webhook semantics all change over time — verify each against current docs at implementation time rather than trusting this review's snapshot.

### Sources

- [Gemini API rate limits (official)](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API pricing/quotas (official)](https://ai.google.dev/gemini-api/docs/pricing)
- [Razorpay — Validate & Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/)
- [Razorpay — Webhook Best Practices](https://razorpay.com/docs/webhooks/best-practices/)
- [Better Auth — Organization plugin](https://better-auth.com/docs/plugins/organization)
- [Vercel AI SDK — Google provider (`@ai-sdk/google`)](https://www.npmjs.com/package/@ai-sdk/google)
