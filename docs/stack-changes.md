# Operato — Stack Changes

This document records the three stack swaps applied to the Operato plan and exactly how to implement each. It supersedes the original plan's Clerk / Stripe / Anthropic choices.

| Was | Now | Why |
|---|---|---|
| Clerk (hosted auth) | **Better Auth** (self-hosted) | Users live in your own Postgres; the Clerk sync webhook disappears; no vendor lock-in. |
| Stripe (payments) | **Razorpay** (payments) | India-first (INR), native UPI AutoPay / e-mandate subscriptions. |
| Anthropic Claude (AI) | **Google Gemini 2.5 Flash** (AI) | Free tier, no card (~10 RPM / ~250 RPD; Flash-Lite for batch); same Vercel AI SDK, so streaming is unchanged. |

**Contents**
1. [Better Auth (replaces Clerk)](#better-auth-replaces-clerk--migration-guide)
2. [Razorpay (replaces Stripe)](#razorpay-replaces-stripe--billing-migration-guide)
3. [Google Gemini 2.5 Flash (replaces Anthropic Claude)](#google-gemini-25-flash-replaces-anthropic-claude--migration-guide)

> External library APIs (Better Auth, Razorpay, `@ai-sdk/google`) and Gemini free-tier quotas change over time — re-check the linked docs before relying on exact signatures or limits.


---

# Better Auth (replaces Clerk) — Migration Guide

> **Scope:** This guide replaces Clerk with [Better Auth](https://better-auth.com) across the Operato stack (Next.js 16 App Router, Prisma + Neon Postgres, TypeScript strict). It is concrete to our multi-tenant model: shared DB, every domain table carries `restaurantId`, and membership lives in the `RestaurantMember` table.
>
> **API currency:** All Better Auth APIs below were verified against the official docs (Better Auth ≥ 1.5, June 2026). External-library surfaces (Better Auth, Razorpay, `@ai-sdk/google`, Gemini limits) move over time — re-check the linked docs before relying on exact signatures or quotas.

---

## 1. The conceptual difference (and its consequence)

| | **Clerk (before)** | **Better Auth (after)** |
|---|---|---|
| What it is | Hosted SaaS auth provider | Self-hosted TypeScript library |
| Where users live | Clerk's servers (you query their API) | **Your Neon Postgres** (`user` table) |
| How your DB learns about a user | **Webhook** (`user.created` → your endpoint) | The row is written **in your DB** at sign-up — no sync needed |
| Source of truth | Clerk's user store | Your Postgres |
| Vendor lock-in | High (data + auth surface owned by Clerk) | None (you own everything) |
| Maintenance | Clerk runs it | You run it |

**Consequence, stated up front:** Because Better Auth writes the user row directly into *your* database in the same Postgres that holds `Restaurant` and `RestaurantMember`, **the entire webhook-based user-sync layer disappears**. There is no longer an external system to reconcile against. You provision a user's restaurant + membership in a **single local Prisma transaction** at onboarding (see §4). This is the central simplification of the migration.

---

## 2. Install + setup

### 2.1 Install

```bash
# terminal (repo root)
npm install better-auth
# Prisma client + CLI are already in the project; if not:
# npm install -D prisma && npm install @prisma/client
```

The Prisma adapter ships **inside** the `better-auth` package (`better-auth/adapters/prisma`) — there is no separate adapter install required for the standard path.

### 2.2 Server instance — `src/lib/auth.ts`

```ts
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  emailAndPassword: {
    enabled: true,
    // requireEmailVerification: true, // enable once you wire an email sender
  },

  // Optional social provider — Google is a natural fit for restaurant owners.
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },

  // MUST be the LAST plugin. It bridges Better Auth's Set-Cookie headers
  // into Next.js's cookies() API so cookies set inside Server Actions persist.
  plugins: [nextCookies()],
});
```

> **Why `nextCookies()` is mandatory:** Server Actions in Next.js discard arbitrary `Set-Cookie` response headers unless the cookie is written through Next's own `cookies()` API. Without this plugin, sign-in/sign-up from a Server Action *appears* to succeed but silently fails to set the session cookie. Keep it **last** in the array.

`src/lib/prisma.ts` is the standard singleton (avoids exhausting Neon connections in dev):

```ts
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

### 2.3 Client instance — `src/lib/auth-client.ts`

```ts
// src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Omit baseURL when the client runs on the same origin as the server.
  // Set it explicitly only for cross-origin setups.
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

### 2.4 Catch-all route — `src/app/api/auth/[...all]/route.ts`

```ts
// src/app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Mounts every Better Auth endpoint (sign-in, sign-up, session, callbacks…)
// under /api/auth/*. Keep this base path unless you also override it in auth.ts.
export const { GET, POST } = toNextJsHandler(auth);
```

---

## 3. Schema impact

### 3.1 Better Auth core models

Better Auth needs four core tables: **`user`**, **`session`**, **`account`** (OAuth/credential links), and **`verification`** (email-verify / reset tokens). You don't hand-write these — generate them from your live config:

```bash
# terminal (repo root) — emits Better Auth models INTO prisma/schema.prisma
npx @better-auth/cli generate
```

> **Important — Prisma + the `migrate` command:** `npx @better-auth/cli migrate` only works with Better Auth's built-in Kysely adapter. **With the Prisma adapter you use `generate` (which writes the models into your schema), then apply them with Prisma's own migration tool.** Do **not** rely on `better-auth/cli migrate` here.

```bash
# terminal (repo root) — apply the generated models via Prisma
npx prisma migrate dev --name better-auth-core
npx prisma generate
```

The generated block looks roughly like this (yours is the source of truth — let the CLI write it):

```prisma
// prisma/schema.prisma  (generated by @better-auth/cli — abbreviated)

model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions Session[]
  accounts Account[]
  members  RestaurantMember[] // ← our relation, added in 3.2

  @@map("user")
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime
  updatedAt DateTime

  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime

  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime?
  updatedAt  DateTime?

  @@map("verification")
}
```

### 3.2 The `RestaurantMember` change

The membership table **stays exactly as the plan has it** — same multi-tenant role, same purpose. The **only** change is swapping the Clerk identity column for a real FK into Better Auth's `user` table.

**Before (Clerk):**

```prisma
// prisma/schema.prisma — BEFORE
model RestaurantMember {
  id           String   @id @default(cuid())
  clerkUserId  String                      // ← opaque Clerk id, no FK
  restaurantId String
  role         Role     @default(STAFF)
  createdAt    DateTime @default(now())

  restaurant Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)

  @@unique([clerkUserId, restaurantId])
  @@index([clerkUserId])
}
```

**After (Better Auth):**

```prisma
// prisma/schema.prisma — AFTER
model RestaurantMember {
  id           String   @id @default(cuid())
  userId       String                      // ← renamed; now a real FK to user.id
  restaurantId String
  role         Role     @default(STAFF)
  createdAt    DateTime @default(now())

  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  restaurant Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)

  @@unique([userId, restaurantId])         // ← updated
  @@index([userId])                        // ← updated
}
```

Changes, exhaustively:

| Field / decorator | Before | After |
|---|---|---|
| identity column | `clerkUserId String` | `userId String` |
| relation | *(none — opaque id)* | `user User @relation(fields: [userId], references: [id], onDelete: Cascade)` |
| composite unique | `@@unique([clerkUserId, restaurantId])` | `@@unique([userId, restaurantId])` |
| index | `@@index([clerkUserId])` | `@@index([userId])` |

Everything else (`id`, `restaurantId`, `role`, `createdAt`, the `restaurant` relation) is **unchanged**. Apply with `npx prisma migrate dev --name member-userid-fk`.

---

## 4. THE KEY SIMPLIFICATION — delete the Clerk webhook

### Before: a webhook just to learn a user exists

With Clerk, the user lived on Clerk's servers, so you needed an inbound webhook to mirror new users into your DB before you could attach them to a restaurant:

```
src/app/api/webhooks/clerk/route.ts   ← DELETE THIS ENTIRE FILE
```

That endpoint verified a Svix signature, parsed `user.created`, and inserted a row — a whole moving part (signing secret, retry handling, idempotency, ordering races against onboarding).

### After: one local transaction at onboarding

Better Auth has **already written the `user` row** into your Postgres by the time onboarding runs. So onboarding becomes a single atomic Prisma transaction that creates the `Restaurant` and the owner `RestaurantMember` together:

```ts
// src/app/(onboarding)/onboarding/actions.ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const onboardingSchema = z.object({
  restaurantName: z.string().min(2).max(80),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
});

export async function completeOnboarding(input: z.infer<typeof onboardingSchema>) {
  const { restaurantName, slug } = onboardingSchema.parse(input);

  // The user already exists in OUR DB — no webhook, no external lookup.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const restaurant = await prisma.$transaction(async (tx) => {
    const created = await tx.restaurant.create({
      data: { name: restaurantName, slug },
    });

    await tx.restaurantMember.create({
      data: {
        userId: session.user.id, // FK straight into Better Auth's user table
        restaurantId: created.id,
        role: "OWNER",
      },
    });

    return created;
  });

  redirect(`/dashboard/${restaurant.id}`);
}
```

**What you deleted:** the webhook route, its Svix/signing-secret env var, signature verification, and the entire class of "user created in Clerk but not yet in our DB" race conditions. **What replaced it:** ~15 lines of transactional code you fully control.

---

## 5. Sessions + route protection

Better Auth resolves the session from the request cookies. There are three contexts, plus one shared guard.

### 5.1 Server Components & Server Actions

```ts
// src/app/dashboard/[restaurantId]/page.tsx (RSC)
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  // session.user.id, session.user.email available
}
```

### 5.2 Proxy (optimistic gate only) — NOT `middleware.ts`

> **Next.js 16 renamed `middleware.ts` to `proxy.ts`** and the named export `middleware` to `proxy`. Use `proxy.ts`. See [nextjs-16-notes.md](nextjs-16-notes.md) §2.

The proxy should do a **cheap cookie presence check** for redirects — not authorization. A full DB validation there is unnecessary and slow.

```ts
// src/proxy.ts   (sits alongside src/app/)
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding"],
};
```

> The cookie check is **optimistic**: it proves a cookie exists, not that it's valid or that the user belongs to a given restaurant. Real authorization happens in the data layer via `requireMember` (below).
>
> `proxy` always runs on the **Node.js runtime** in Next 16 — the runtime is not configurable and `edge` is unsupported there. So a DB-backed `auth.api.getSession` call inside the proxy is now *possible*, but it still isn't worth it: it adds a database round-trip to every matched request and it still can't answer the only question that matters ("is this user a member of *this* restaurant?"). Keep the proxy dumb; keep `requireMember` as the security boundary.

### 5.3 API Route Handlers

```ts
// src/app/api/restaurants/[restaurantId]/menu/route.ts
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ restaurantId: string }> },
) {
  const { restaurantId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  // ...
}
```

### 5.4 The shared `requireMember(restaurantId)` guard — call it EVERYWHERE

A valid session means "is logged in", **not** "may touch this restaurant's data". Tenancy is enforced by checking the `RestaurantMember` row. Centralize it:

```ts
// src/lib/auth-guard.ts
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

/**
 * Returns { session, member } or throws AuthError.
 * Use in EVERY dashboard route AND EVERY /api route that touches tenant data.
 */
export async function requireMember(restaurantId: string, minRole?: Role) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AuthError(401, "Not authenticated");

  const member = await prisma.restaurantMember.findUnique({
    where: { userId_restaurantId: { userId: session.user.id, restaurantId } },
  });
  if (!member) throw new AuthError(403, "Not a member of this restaurant");

  if (minRole && !hasRole(member.role, minRole)) {
    throw new AuthError(403, "Insufficient role");
  }
  return { session, member };
}

const ORDER: Role[] = ["STAFF", "MANAGER", "OWNER"];
function hasRole(actual: Role, required: Role) {
  return ORDER.indexOf(actual) >= ORDER.indexOf(required);
}
```

> **Critical gotcha:** `dashboard/layout.tsx` protecting the dashboard segment does **NOT** protect `/api/*` routes. App Router layouts wrap **page** rendering only; an API route handler is invoked directly by an HTTP request and never passes through any layout. **Every API route must call `requireMember` itself.** Treat the layout guard as UX (redirect logged-out users), and `requireMember` as the real security boundary on both pages and APIs.

Example API usage:

```ts
// src/app/api/restaurants/[restaurantId]/menu/route.ts
import { requireMember, AuthError } from "@/lib/auth-guard";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ restaurantId: string }> },
) {
  const { restaurantId } = await params;
  try {
    await requireMember(restaurantId, "MANAGER");
  } catch (e) {
    if (e instanceof AuthError) return new Response(e.message, { status: e.status });
    throw e;
  }
  // ...mutate menu, always scoped by restaurantId
}
```

---

## 6. The multi-tenant membership decision

The user said **either approach works**. Here is the recommendation and the honest trade-off.

### ✅ Recommended: keep `RestaurantMember`, keyed by Better Auth `userId`

Manage membership yourself with the existing table (now FK'd to `user.id`).

**Why this wins for Operato:**
- **One source of truth.** Membership already lives in `RestaurantMember`; tenancy is already `restaurantId` on every domain table. Introducing a second membership concept would mean two tables answering "who belongs to what".
- **Matches the existing schema and the AI schema-context.** The Gemini schema-context that powers AI features describes `RestaurantMember`. Keeping it means the AI's mental model of the DB stays accurate; adding Better Auth's `member`/`organization` tables would fork that model.
- **No duplicate concept.** Roles (`OWNER`/`MANAGER`/`STAFF`) and the `restaurantId` scoping are bespoke to a restaurant product, not generic "org" semantics.
- **Minimal surface.** Four core auth tables + your existing membership table. Nothing new to learn or migrate.

The cost: you write invitation and role-management logic yourself (it's modest — a few server actions over `RestaurantMember`).

### ⚖️ Alternative: the Better Auth **organization plugin**

```ts
// src/lib/auth.ts (only if you adopt this)
import { organization } from "better-auth/plugins";
// plugins: [organization(), nextCookies()]  // nextCookies still last
```
```ts
// src/lib/auth-client.ts
import { organizationClient } from "better-auth/client/plugins";
// createAuthClient({ plugins: [organizationClient()] })
```

It adds its own tables — **`organization`**, **`member`** (`userId`, `organizationId`, `role`), **`invitation`** (`email`, `inviterId`, `role`, `status`, `expiresAt`), optional `organizationRole`/`team`/`teamMember` — and puts **`activeOrganizationId`** on the `session`. You get **invitations, roles (owner/admin/member), and active-org switching out of the box**.

| | **Keep `RestaurantMember` (recommended)** | **Organization plugin** |
|---|---|---|
| Source of truth for membership | `RestaurantMember` (one table) | `member` + `organization` (and you'd still map `Restaurant` → org) |
| Invitations / role flows | You build them (small) | Built-in (email invites, accept/reject, expiry) |
| Active-tenant context | You pass `restaurantId` explicitly | `activeOrganizationId` on the session |
| Schema/AI alignment | Matches plan + Gemini schema-context exactly | Diverges; two membership models to reconcile |
| New concepts to maintain | None | Org/team/invitation tables + plugin semantics |
| Coupling | Membership owned by your app | Membership owned by the auth library |

**When the plugin is genuinely worth adopting:** when invitation-and-role management becomes a real, growing feature — multi-person restaurant teams sending email invites, role hierarchies you'd otherwise hand-roll, users switching between multiple restaurants via a stored "active org", or teams/sub-locations. At that point the plugin's built-in invitation lifecycle saves more than the schema duplication costs.

**Concrete recommendation:** **Ship with `RestaurantMember`.** Revisit the organization plugin only if/when team invitations and active-org switching become first-class product requirements. Migrating later is a contained data move (`RestaurantMember` rows → `member`, `Restaurant` ↔ `organization`), not a rewrite.

---

## 7. Environment variables

```dotenv
# .env  (NEVER commit; .env.example carries the keys with blank values)

# --- Better Auth (required) ---
BETTER_AUTH_SECRET="<openssl rand -base64 32>"   # ≥ 32 chars; signs sessions
BETTER_AUTH_URL="http://localhost:3000"          # canonical app URL (prod: https://app.operato.com)
NEXT_PUBLIC_BETTER_AUTH_URL="http://localhost:3000" # only if auth-client needs an explicit baseURL

# --- Database (Neon serverless Postgres) ---
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"

# --- Optional social provider (only if enabled in auth.ts) ---
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
```

Notes:
- Generate the secret with `openssl rand -base64 32`. It must be **at least 32 characters**; rotating it invalidates all existing sessions.
- `BETTER_AUTH_URL` must match the deployed origin in production, or OAuth callbacks and cookie domains break.
- The Clerk env vars (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`/`SIGNING_SECRET`) are **removed** entirely.

---

## 8. Interview talking point — rewritten

### Before — "Why Clerk over NextAuth?"
> *Clerk gave us a hosted, batteries-included user store with a polished UI and webhooks, so we didn't have to build auth screens or own the user data.*

### After — "Why Better Auth?"

> **"We chose Better Auth, a self-hosted TypeScript auth library, over both a hosted provider like Clerk and a heavier framework like NextAuth.**
>
> **The deciding factor was data ownership in a multi-tenant Postgres app.** With Clerk, users live on Clerk's servers, so we'd have needed an inbound webhook just to mirror new users into our own database before we could attach them to a restaurant — a whole sync layer with signing secrets, retries, and ordering races. Better Auth writes the user row **directly into our Neon Postgres** via its own `user`/`session`/`account` tables. So at onboarding we create the restaurant and the owner membership in **one local Prisma transaction** — the webhook and its entire failure surface simply don't exist. Our `RestaurantMember` table just becomes a real foreign key to `user.id`, keeping a single source of truth for tenancy.
>
> **The honest trade-off is that we now own the auth surface and the data — and the maintenance.** There's no vendor managing it for us: we run the migrations, we'd handle email verification and password-reset delivery ourselves, and we're responsible for keeping the dependency patched. In exchange we get **zero vendor lock-in**, no per-MAU pricing, full control over the schema, and auth that lives in the same transaction boundary as the rest of our domain data. For a multi-tenant product where every table is scoped by `restaurantId`, having identity in the same database we already control was worth owning more of the stack. If team invitations and role management grow into a major feature, Better Auth's organization plugin gives us invitations and roles out of the box without changing providers — so the decision scales with us."

---

## Migration checklist

- [ ] `npm install better-auth`; remove `@clerk/*` packages
- [ ] Create `src/lib/auth.ts` (`betterAuth` + `prismaAdapter` + `nextCookies` **last**)
- [ ] Create `src/lib/auth-client.ts` (`createAuthClient`)
- [ ] Create `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler`)
- [ ] `npx @better-auth/cli generate` → `npx prisma migrate dev` for core tables
- [ ] Rename `clerkUserId` → `userId` (FK), update `@@unique`/`@@index`; migrate
- [ ] **Delete** `src/app/api/webhooks/clerk/route.ts` and its signing secret
- [ ] Move restaurant + owner-member creation into the onboarding transaction (§4)
- [ ] Add `src/lib/auth-guard.ts`; call `requireMember` in **every** dashboard route **and** API route
- [ ] Swap Clerk env vars for `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` (+ provider keys)
- [ ] Update the interview talking point (§8)

---

### Sources
- [Better Auth — Installation](https://better-auth.com/docs/installation)
- [Better Auth — Next.js integration](https://better-auth.com/docs/integrations/next)
- [Better Auth — Prisma adapter](https://better-auth.com/docs/adapters/prisma)
- [Better Auth — Organization plugin](https://better-auth.com/docs/plugins/organization)
- [@better-auth/cli — npm](https://www.npmjs.com/package/@better-auth/cli)
- [Better Auth 1.5 release notes](https://better-auth.com/blog/1-5)
- [Prisma — Better Auth + Next.js guide](https://www.prisma.io/docs/guides/authentication/better-auth/nextjs)
- [Gemini API — Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) (free-tier quotas change over time; verify before relying on them)

---

# Razorpay (replaces Stripe) — Billing Migration Guide

> **Scope:** Operato is India-based (currency **INR**, timezone **Asia/Kolkata**). Billing is a single, simple choice per restaurant: **Free** vs **Pro**. There are no metered plans, no per-seat math, no multi-currency. This guide replaces the Stripe subscription flow end-to-end with Razorpay **Plans + Subscriptions**.
>
> **API currency note:** The Razorpay Subscriptions API, the `razorpay` Node SDK, Checkout.js, and the webhook event set described here were verified against Razorpay's docs at the time of writing. Razorpay periodically changes payloads and adds events — re-check the [Subscriptions APIs](https://razorpay.com/docs/api/payments/subscriptions/) and [Subscriptions Webhook Events](https://razorpay.com/docs/webhooks/subscriptions/) pages before shipping.

---

## 1. Concepts: how Razorpay differs from Stripe

You already have a working mental model from Stripe. Here is the mapping, then the differences that actually change your code.

| Concept | Stripe | Razorpay |
| --- | --- | --- |
| Reusable price template | `Price` (under a `Product`) | **`Plan`** |
| The recurring agreement | `Subscription` | **`Subscription`** |
| Customer record | `Customer` (`stripeCustomerId`) | `Customer` (optional for subs; `razorpayCustomerId`) |
| Client-side payment UI | Stripe.js / Checkout / Elements | **Checkout.js** (`checkout.razorpay.com/v1/checkout.js`) |
| Server creates a payable object | `PaymentIntent` / `Subscription` | `subscriptions.create()` (returns `sub_…` + `short_url`) |
| Webhook auth header | `stripe-signature` | **`x-razorpay-signature`** |
| Webhook verification | `stripe.webhooks.constructEvent(rawBody, sig, secret)` | **manual HMAC-SHA256** over the raw body (see §4) |
| Source of truth for plan state | webhook events | webhook events |

### The differences that matter

1. **No `constructEvent` helper in the webhook path.** Stripe's `constructEvent` both verifies the signature *and* parses the event in one call. Razorpay gives you `validateWebhookSignature(...)` (a boolean check), but **you still parse the body yourself** and you **must verify against the raw body** — see §4.
2. **Checkout drives subscription authorization, not the API.** With Stripe you often create the subscription and the first charge happens server-side. With Razorpay, you create the subscription server-side (status `created`), then hand its `subscription_id` to **Checkout.js on the client**, where the customer authorizes the recurring mandate (UPI AutoPay / card / e-mandate). Activation is then confirmed by webhook.
3. **Authorized ≠ captured / activated.** A successful Checkout returns an *authorization*. The subscription becoming **`active`** (and the first invoice being **`charged`**) is signalled asynchronously by webhooks. Treat the webhook — not the Checkout handler callback — as the source of truth for entitlement.
4. **Subscriptions must be explicitly enabled** on the Razorpay account (it is a separate product from one-time Payments). See §7.

### Account, keys, and the SDK

- Create an account at [dashboard.razorpay.com](https://dashboard.razorpay.com). Toggle **Test Mode** in the dashboard to get **test keys**; switch to **Live Mode** (requires KYC + activation) for **live keys**.
- Keys come as a pair: a **Key ID** (`rzp_test_…` / `rzp_live_…`, safe to expose on the client) and a **Key Secret** (server-only, shown once at generation).
- The **webhook secret** is a *separate* value you choose when registering the webhook in **Settings → Webhooks** — it is **not** the Key Secret.

```bash
# install the official Node SDK
npm i razorpay
```

```ts
// src/lib/razorpay.ts
import Razorpay from "razorpay";

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  throw new Error("Razorpay keys are not configured");
}

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
```

---

## 2. Plans + Subscriptions

### Free vs Pro

| Plan | Razorpay object | Notes |
| --- | --- | --- |
| **FREE** | **none** | The default. No plan, no subscription, no Razorpay call. Just `Restaurant.plan = FREE`. |
| **PRO** | an **active Subscription** | One `sub_…` per restaurant, built on the shared Pro `Plan`. Entitlement = the subscription is `active`. |

### Create the Pro plan once (not per restaurant)

A `Plan` is a reusable template; you create it **once** (dashboard or a one-off script) and reuse its `plan_id` for every Pro subscription. Store the resulting `plan_id` in env (`RAZORPAY_PRO_PLAN_ID`).

```ts
// scripts/create-pro-plan.ts — run once per environment (test, then live)
import { razorpay } from "@/lib/razorpay";

const plan = await razorpay.plans.create({
  period: "monthly",
  interval: 1,                       // every 1 month
  item: {
    name: "Operato Pro",
    amount: 99900,                   // ₹999.00 — amount is in PAISE
    currency: "INR",
    description: "Operato Pro plan — unlimited AI queries, weekly summaries, alerts",
  },
});

console.log("RAZORPAY_PRO_PLAN_ID =", plan.id); // plan_xxxxxxxxxxxxxx
```

> **Amounts are in paise.** ₹999 = `99900`. This mirrors Stripe's "smallest currency unit" rule (cents → paise).

### Create a subscription for a restaurant (server route)

When a Free restaurant upgrades, create a subscription server-side and return only what the client Checkout needs.

```ts
// src/app/api/billing/subscribe/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";          // Better Auth server instance
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { razorpay } from "@/lib/razorpay";

export async function POST() {
  // Better Auth: resolve the session from request headers
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Resolve the caller's active restaurant via RestaurantMember (tenant scoping)
  const member = await prisma.restaurantMember.findFirst({
    where: { userId: session.user.id },
    select: { restaurantId: true, role: true },
  });
  if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: member.restaurantId },
  });
  if (!restaurant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (restaurant.plan === "PRO") {
    return NextResponse.json({ error: "Already on Pro" }, { status: 409 });
  }

  const subscription = await razorpay.subscriptions.create({
    plan_id: process.env.RAZORPAY_PRO_PLAN_ID!,
    total_count: 12,            // bill for 12 cycles (1 year of monthly); required field
    quantity: 1,
    customer_notify: 1,         // Razorpay emails/SMS the customer about charges
    notes: {                    // free-form metadata echoed back in webhooks
      restaurantId: restaurant.id,
    },
  });

  // Persist the subscription id immediately so webhooks can be correlated
  await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: { razorpaySubscriptionId: subscription.id },
  });

  // Return ONLY what Checkout.js needs. Never send the key secret.
  return NextResponse.json({
    subscriptionId: subscription.id,                 // sub_xxxxxxxxxxxxxx
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,  // safe to expose
  });
}
```

> `total_count` is **required** and is the number of billing cycles, not months-as-duration. For "until cancelled" semantics, pick a large count (e.g. 120 for 10 years of monthly) and rely on cancellation/`subscription.cancelled` to end it.

---

## 3. Client flow: Razorpay Checkout

The freshly created subscription is in status `created`. The customer authorizes it through Checkout.js. On success, the handler posts to a verify endpoint.

### Load the script

```tsx
// src/components/billing/upgrade-button.tsx
"use client";

import { useState } from "react";
import Script from "next/script";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function UpgradeButton({ user }: { user: { name: string; email: string } }) {
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    // 1) Ask the server to create the subscription
    const res = await fetch("/api/billing/subscribe", { method: "POST" });
    const { subscriptionId, keyId } = await res.json();

    // 2) Open Checkout with the subscription_id (NOT order_id)
    const rzp = new window.Razorpay({
      key: keyId,                       // NEXT_PUBLIC_RAZORPAY_KEY_ID
      subscription_id: subscriptionId,  // sub_… — this is what makes it a subscription flow
      name: "Operato",
      description: "Operato Pro — monthly",
      prefill: { name: user.name, email: user.email },
      theme: { color: "#0f172a" },
      // 3) Handler fires on successful authorization (client-side, do NOT trust for entitlement)
      handler: async (response: {
        razorpay_payment_id: string;
        razorpay_subscription_id: string;
        razorpay_signature: string;
      }) => {
        await fetch("/api/billing/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(response),
        });
        // Show "activating…"; real entitlement is confirmed by webhook (§4)
        window.location.href = "/dashboard/billing?status=processing";
      },
    });
    rzp.open();
    setLoading(false);
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <Button onClick={handleUpgrade} disabled={loading}>
        {loading ? "Loading…" : "Upgrade to Pro"}
      </Button>
    </>
  );
}
```

### The verify endpoint

For a **subscription** Checkout, the handler returns `razorpay_payment_id`, `razorpay_subscription_id`, and `razorpay_signature`. The signature is HMAC-SHA256 over `razorpay_payment_id + "|" + razorpay_subscription_id` (note the order — subscription id is second, unlike one-time orders where the order id is first).

```ts
// src/app/api/billing/verify/route.ts
import { NextResponse } from "next/server";
import crypto from "node:crypto";

export async function POST(req: Request) {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } =
    await req.json();

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest("hex");

  // timing-safe compare
  const valid =
    expected.length === razorpay_signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));

  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Authorization confirmed. Do NOT mark PRO here — wait for subscription.activated
  // / subscription.charged via webhook (§4), which is the entitlement source of truth.
  return NextResponse.json({ ok: true });
}
```

> **Why not grant Pro here?** The verify call confirms the customer *authorized* the mandate. The first charge can still fail (insufficient funds, bank decline). The webhook (`subscription.activated` / `subscription.charged`) is the authoritative signal. Verify here purely to reject forged callbacks and to show an optimistic "processing" UI.

---

## 4. Webhook route

Path: `src/app/api/webhooks/razorpay/route.ts`.

### Signature verification (contrast with Stripe)

| | Stripe | Razorpay |
| --- | --- | --- |
| Header | `stripe-signature` | `x-razorpay-signature` |
| Verify call | `stripe.webhooks.constructEvent(rawBody, header, whSecret)` — verifies **and** parses | `crypto.createHmac("sha256", whSecret).update(rawBody).digest("hex")` then compare to header (or `validateWebhookSignature`) |
| Signed payload | raw body | **raw body** (same rule) |
| Parsing | done by `constructEvent` | you `JSON.parse` **after** verifying |

The signature is HMAC-SHA256 of the **raw request body** keyed by `RAZORPAY_WEBHOOK_SECRET`. **Do not** use a re-serialized `JSON.stringify(req.body)` — key ordering / whitespace differences will break the HMAC. In the Next.js App Router, read the raw body with `req.text()`.

```ts
// src/app/api/webhooks/razorpay/route.ts
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";

// Subscriptions billing must run on the Node.js runtime (crypto + Prisma)
export const runtime = "nodejs";

export async function POST(req: Request) {
  // 1) RAW body — required for a correct HMAC. Never req.json() first.
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest("hex");

  const valid =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  if (!valid) {
    // 401 so Razorpay does NOT keep retrying a genuinely-forged request
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    payload: {
      subscription: {
        entity: {
          id: string;
          status: string;
          current_end: number | null; // unix seconds
          notes?: { restaurantId?: string };
        };
      };
    };
  };

  const sub = event.payload.subscription.entity;

  // 2) Correlate to a tenant. Prefer the id we stored; fall back to notes.
  const restaurant = await prisma.restaurant.findFirst({
    where: {
      OR: [
        { razorpaySubscriptionId: sub.id },
        sub.notes?.restaurantId ? { id: sub.notes.restaurantId } : undefined,
      ].filter(Boolean) as object[],
    },
    select: { id: true },
  });

  // 3) Always 200 for an unknown-but-authentic event so Razorpay stops retrying.
  if (!restaurant) return NextResponse.json({ received: true });

  const expiresAt = sub.current_end ? new Date(sub.current_end * 1000) : null;

  // 4) Idempotent state updates. Re-delivering the same event is harmless.
  switch (event.event) {
    case "subscription.activated":
    case "subscription.charged":
      await prisma.restaurant.update({
        where: { id: restaurant.id },
        data: {
          plan: "PRO",
          razorpaySubscriptionId: sub.id,
          planExpiresAt: expiresAt, // extend access to the new period end
        },
      });
      break;

    case "subscription.halted":     // retries exhausted — revoke access
    case "subscription.cancelled":  // ended before completion
      await prisma.restaurant.update({
        where: { id: restaurant.id },
        data: { plan: "FREE", planExpiresAt: expiresAt },
      });
      break;

    default:
      // subscription.authenticated / pending / completed / updated — log, no-op
      break;
  }

  // 5) Return 200 fast. Razorpay treats non-2xx as failure and retries.
  return NextResponse.json({ received: true });
}
```

### Rules this route follows (and why)

- **Read the RAW body.** Signature is computed over exact bytes. `req.text()` before any parse. (The App Router does not pre-parse `Request`, so this is straightforward — no `bodyParser: false` toggle like the Pages Router needed.)
- **Idempotent.** Razorpay retries on any non-2xx and can deliver duplicates. Every branch is a deterministic "set this state," so replays converge to the same result. If you need strict once-only side effects (e.g. sending an email), persist the delivered event id and skip if already seen.
- **Return 200 fast.** Do the minimal write and respond. Offload anything slow. A slow/failing handler causes retry storms.
- **Map events to state, not to imperative actions.** `activated`/`charged` ⇒ Pro + extend `planExpiresAt`; `halted`/`cancelled` ⇒ Free.

### Subscription event reference

| Event | State it reflects | Operato action |
| --- | --- | --- |
| `subscription.authenticated` | mandate authorized, not yet active | none (log) |
| `subscription.activated` | first cycle active | **→ PRO**, set `planExpiresAt` |
| `subscription.charged` | a cycle paid (incl. renewals) | **→ PRO**, extend `planExpiresAt` |
| `subscription.pending` | a charge failed, retries scheduled | none / notify owner (grace) |
| `subscription.halted` | retries exhausted | **→ FREE** |
| `subscription.cancelled` | cancelled before completion | **→ FREE** |
| `subscription.completed` | all `total_count` cycles done | optional **→ FREE** at period end |
| `subscription.updated` | plan/quantity changed | reconcile if needed |

Payloads always carry `payload.subscription.entity`; charge-related events additionally carry `payload.payment.entity`. The `current_end` / `charge_at` timestamps live on the subscription entity (unix seconds — multiply by 1000 for JS `Date`).

---

## 5. Schema impact

Rename the Stripe column to a Razorpay one and add the subscription id. The `Plan` enum is unchanged.

```prisma
// prisma/schema.prisma

enum Plan {
  FREE
  PRO
}

model Restaurant {
  id               String    @id @default(cuid())
  name             String
  slug             String    @unique
  logo             String?
  timezone         String    @default("Asia/Kolkata")
  currency         String    @default("INR")
  plan             Plan      @default(FREE)
  planExpiresAt    DateTime?

  // --- billing (was Stripe) ---
  razorpayCustomerId     String?  @unique  // renamed from stripeCustomerId
  razorpaySubscriptionId String?  @unique  // new: the active sub_… for Pro
  // -----------------------------

  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  // …relations unchanged…
}
```

Generate a migration that **renames** rather than drops+recreates so existing data is preserved:

```sql
-- prisma/migrations/<timestamp>_razorpay_billing/migration.sql
ALTER TABLE "Restaurant" RENAME COLUMN "stripeCustomerId" TO "razorpayCustomerId";
ALTER TABLE "Restaurant" ADD COLUMN "razorpaySubscriptionId" TEXT;
CREATE UNIQUE INDEX "Restaurant_razorpaySubscriptionId_key"
  ON "Restaurant"("razorpaySubscriptionId");
```

> If you let `prisma migrate dev` autogenerate, it may emit `DROP COLUMN stripeCustomerId` + `ADD COLUMN razorpayCustomerId` (data loss). Edit the migration to a `RENAME COLUMN` as above before applying to anything with real rows.

---

## 6. Environment variables

```bash
# .env

# Server-only (NEVER expose)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=your_chosen_webhook_secret   # set in Dashboard → Webhooks, NOT the key secret
RAZORPAY_PRO_PLAN_ID=plan_xxxxxxxxxxxxxx

# Client-safe (the Key ID is meant to be public)
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx  # mirror of RAZORPAY_KEY_ID for Checkout.js
```

| Variable | Where used | Notes |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` | server SDK init | `rzp_test_…` / `rzp_live_…` |
| `RAZORPAY_KEY_SECRET` | server SDK init, verify endpoint HMAC | secret; shown once |
| `RAZORPAY_WEBHOOK_SECRET` | webhook signature verification | separate secret you choose per webhook |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Checkout.js `key` option | same value as Key ID, exposed to the browser |

Use **test** keys in dev/preview and **live** keys only in production. The Key ID prefix (`rzp_test_` vs `rzp_live_`) tells you which mode you are in at a glance.

---

## 7. Gotchas

- **Subscriptions must be enabled on the account.** Subscriptions is a distinct Razorpay product. If `subscriptions.create()` returns a "not enabled / not activated" error, request access in the dashboard (Subscriptions section) and complete activation. One-time Payments being enabled does **not** imply Subscriptions are.
- **Authorized vs captured.** A successful Checkout = an *authorization* of the mandate. The actual money movement (`subscription.charged`) and the subscription going `active` are asynchronous. Never grant Pro off the client handler — grant it from the webhook. For auto-capture behaviour on charges, ensure your account/plan is set to capture automatically rather than leaving payments authorized.
- **Webhook retries + idempotency.** Razorpay retries any non-2xx delivery and can send duplicates even on success. Make handlers idempotent (state-setting, not action-appending) and, for non-idempotent side effects, dedupe on a stored event id.
- **Reconciliation for missed webhooks.** Webhooks can be missed (downtime, deploys). Add a periodic reconcile job (reuse Vercel Cron) that, for every restaurant with a `razorpaySubscriptionId`, calls `razorpay.subscriptions.fetch(id)` and re-syncs `plan` / `planExpiresAt` from the authoritative `status` + `current_end`. This also self-heals any drift.
- **Always read the raw body.** The single most common Razorpay webhook bug is verifying against a re-stringified parsed body. Use `req.text()` and HMAC that exact string.
- **Test-mode cards & methods.** In Test Mode use Razorpay's [test cards](https://razorpay.com/docs/payments/payments/test-card-details/) (e.g. `4111 1111 1111 1111`, any future expiry, any CVV) and test UPI ids to simulate success/failure. To exercise webhooks locally, tunnel (ngrok / cloudflared) and register the public URL in Dashboard → Webhooks, or use Razorpay's "test webhook" feature. Test-mode `sub_…`/`plan_…` ids do not exist in Live and vice-versa.
- **Paise, not rupees.** Every amount in the API is in paise. `₹999 → 99900`. A factor-of-100 bug here charges 100× or 1/100×.
- **Timezone.** Razorpay timestamps are unix seconds (UTC). Render against `Asia/Kolkata` in the UI; store the raw `Date` (UTC) in `planExpiresAt`.

---

## 8. Plan-copy updates (Operato project plan)

These edits reframe the existing Stripe references in `operato_project_plan.html` for Razorpay. Apply them verbatim.

**Resume / stack badge line** (`Stripe subscriptions` badge):

```html
<!-- operato_project_plan.html — hero badges -->
<span class="badge">Razorpay subscriptions</span>
```

**Stack summary row:**

```html
<!-- operato_project_plan.html — "Stack" kv row -->
<span class="kv2">Next.js 16, TypeScript, Prisma, PostgreSQL (Neon), Better Auth, Razorpay, Google Gemini</span>
```

**Phase checklist item:**

```html
<!-- operato_project_plan.html — phase list -->
<li>Razorpay billing &amp; plans (Free/Pro)</li>
```

**"Vertical-agnostic from day one" architecture note:**

```html
<!-- operato_project_plan.html — extensibility list -->
<li>Razorpay plans and the dashboard shell are domain-agnostic from day one</li>
```

**Payments &amp; Uploads table row:**

```html
<!-- operato_project_plan.html — Payments & Uploads -->
<div class="trow">
  <span class="tn">Razorpay</span>
  <span class="tw">Subscription billing (Free/Pro) in INR. Webhook-driven plan changes
  (subscription.activated/charged/halted/cancelled). Shows you can build real SaaS
  revenue flow for the Indian market — and it's vertical-agnostic from day one.</span>
</div>
```

**File-tree comment** (webhooks folder):

```text
src/app/api/webhooks/
├── better-auth/route.ts    # Sync user to RestaurantMember
└── razorpay/route.ts       # Subscription state → Restaurant.plan
```

**Timeline — Week 4 task** (was "Stripe subscription flow"):

```html
<!-- operato_project_plan.html — Week 4 -->
<div class="week"><div class="wn">Week 4</div><div class="wc">
  <div class="wt">Razorpay + Landing page + Demo</div>
  <div class="wd">Razorpay subscription flow (Plans + Subscriptions, Checkout.js,
  HMAC-verified webhooks, INR). Landing page positioning Operato as the AI OS
  (restaurant first). 3-minute Loom demo. Update resume. GitHub README with
  architecture diagram.</div>
</div></div>
```

---

### Sources

- [Razorpay — Subscriptions APIs](https://razorpay.com/docs/api/payments/subscriptions/)
- [Razorpay — Integrate With Subscriptions](https://razorpay.com/docs/payments/subscriptions/integration-guide/)
- [Razorpay — Create and View Plans](https://razorpay.com/docs/payments/subscriptions/create-plans/)
- [razorpay-node — subscription docs](https://github.com/razorpay/razorpay-node/blob/master/documents/subscription.md)
- [Razorpay — Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/)
- [Razorpay — Subscriptions Webhook Events](https://razorpay.com/docs/webhooks/subscriptions/)
- [Razorpay — Test Card Details](https://razorpay.com/docs/payments/payments/test-card-details/)

---

# Google Gemini 2.5 Flash (replaces Anthropic Claude)

> **Migration guide for Operato's AI layer.** This swaps the LLM *provider* from Anthropic Claude (`claude-sonnet-4-6`) to Google Gemini 2.5 Flash (`gemini-2.5-flash`). The entire AI layer is built on the **Vercel AI SDK**, so we keep that abstraction and change only the provider binding. The streaming UI, the `useChat` hook, and the data-stream HTTP response are essentially untouched.

---

## TL;DR

| | Before | After |
| --- | --- | --- |
| SDK / provider package | `@anthropic-ai/sdk` (direct) | `ai` + `@ai-sdk/google` |
| Model id | `claude-sonnet-4-6` | `gemini-2.5-flash` |
| Auth env var | `ANTHROPIC_API_KEY` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Structured SQL step | `JSON.parse(res.content[0].text)` | `generateObject` + Zod schema |
| Streaming step | `streamText` | `streamText` (unchanged shape) |
| Cron / inventory text | `generateText` | `generateText` (provider swapped) |
| Cost (demo) | Paid per token | **Free tier** (with caveats below) |

Because the Vercel AI SDK normalizes providers behind `streamText` / `generateText` / `generateObject`, this is a **small, clean swap** — not a rewrite. The only feature that materially changes is the Text‑to‑SQL route, and that change is an *improvement* (it removes a real fragility bug), not a porting tax.

> **Verify before you ship.** Provider APIs, model ids, and free-tier quotas change frequently. Numbers in this guide were confirmed in mid‑2026 from Google's official [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and [API terms](https://ai.google.dev/gemini-api/terms) pages, and the [AI SDK Google provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai). Re-check the live dashboard at `https://aistudio.google.com/rate-limit` before relying on a specific limit.

---

## 1. Install + provider setup

### Packages

```bash
# repo root
pnpm add ai @ai-sdk/google zod
```

- **`ai`** — the provider-agnostic Vercel AI SDK core (`streamText`, `generateText`, `generateObject`, `streamObject`) plus React bindings (`useChat`).
- **`@ai-sdk/google`** — the Google Generative AI (Gemini) provider for the AI SDK.
- **`zod`** — already a project dependency; used for the structured SQL schema.

### API key

1. Create a key in **Google AI Studio** → <https://aistudio.google.com/apikey> (no credit card required for the free tier).
2. Add it to the environment. The Google provider reads `GOOGLE_GENERATIVE_AI_API_KEY` **by default** — you do not pass it in code.

```bash
# .env.local  (and Vercel project env vars)
GOOGLE_GENERATIVE_AI_API_KEY="AIza...your-key..."
```

```ts
// src/env.ts  — keep the schema-validated env (Zod) approach
export const env = {
  // ...
  GOOGLE_GENERATIVE_AI_API_KEY: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
};
```

### A single shared model factory

Centralize the model so every feature imports one binding (interactive + batch). Swapping models later (e.g. to a paid tier, Vertex AI, or back to Claude) becomes a one-line change.

```ts
// src/lib/ai/model.ts
import { google } from "@ai-sdk/google";

// Pin models in one place. Interactive Text-to-SQL wants reasoning quality; the
// weekly cron is a high-volume, easy task — give it Flash-Lite for more free
// headroom (higher RPM/RPD). Swapping any of these is a one-line change.
export const aiModel = google("gemini-2.5-flash");           // interactive (Text-to-SQL)
export const aiBatchModel = google("gemini-2.5-flash-lite"); // weekly-summary cron
```

### Why the UI barely changes

The AI SDK's whole point is that providers are interchangeable behind `streamText` etc. The HTTP route still returns a data-stream response, and the client still consumes it with `useChat`:

```ts
// server: the response shape is provider-agnostic
const result = streamText({ model: aiModel, /* ... */ });
return result.toUIMessageStreamResponse();
```

```tsx
// src/components/ai/query-chat.tsx  — UNCHANGED across the migration
"use client";
import { useChat } from "@ai-sdk/react";

export function QueryChat({ restaurantId }: { restaurantId: string }) {
  const { messages, sendMessage, status } = useChat({
    api: `/api/restaurants/${restaurantId}/ai/query`,
  });
  // ...render messages exactly as before
}
```

The client doesn't know or care that Claude became Gemini.

---

## 2. Feature A — Text-to-SQL route (rewritten)

**File:** `src/app/api/restaurants/[restaurantId]/ai/query/route.ts`

### What was fragile before

The original called `anthropic.messages.create({ model: "claude-sonnet-4-6", ... })` and then did:

```ts
// BEFORE — fragile
const res = await anthropic.messages.create({ /* ... */ });
const { sql, params } = JSON.parse(res.content[0].text); // 💥 throws if the
// model wraps JSON in prose, adds ```json fences, or trails a comma
```

Hand-parsing free-form model text is brittle: any markdown fence, explanatory sentence, or stray token breaks `JSON.parse`, and you get a 500 with no useful recovery. **This is a real bug, not a hypothetical.**

### The fix: `generateObject` + a Zod schema

`generateObject` constrains the model to a schema (the SDK sends the JSON Schema to Gemini, then validates the response and returns a typed `object`). The structured SQL step becomes reliable and type-safe. We keep the natural-language answer on `streamText`, exactly as before — just on Gemini.

```ts
// src/app/api/restaurants/[restaurantId]/ai/query/route.ts
import { NextRequest } from "next/server";
import { generateObject, streamText } from "ai";
import { z } from "zod";
import { aiModel } from "@/lib/ai/model";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSchemaContext, SAFETY_RULES } from "@/lib/ai/sql-context";
import { assertMember } from "@/lib/auth/membership";
import { enforceAiRateLimit } from "@/lib/ai/rate-limit"; // see §5(c)

// Structured contract for the SQL-generation step.
const SqlPlan = z.object({
  sql: z.string().describe("A single read-only SQL SELECT statement. No DDL/DML."),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .describe("Positional parameters for the SQL, in order."),
});

export async function POST(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ restaurantId: string }> },
) {
  const { restaurantId } = await routeParams;

  // Better Auth session + tenant membership check (unchanged by the model swap).
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  await assertMember(session.user.id, restaurantId);

  // Per-tenant rate limit — see §5(c). Throws/returns 429 if the tenant is over quota.
  const limit = await enforceAiRateLimit(restaurantId);
  if (!limit.ok) {
    return Response.json(
      { error: "Daily AI query limit reached for this restaurant." },
      { status: 429 },
    );
  }

  const { question } = (await req.json()) as { question: string };

  // STEP 1 — structured SQL generation (was JSON.parse of Claude text).
  const { object: plan } = await generateObject({
    model: aiModel, // google('gemini-2.5-flash')
    schema: SqlPlan,
    system: `${buildSchemaContext(restaurantId)}\n\n${SAFETY_RULES}`,
    prompt: question,
  });

  // Same safety gate as before: read-only SELECT only.
  const trimmed = plan.sql.trim();
  if (!/^select\b/i.test(trimmed)) {
    return Response.json(
      { error: "Only read-only SELECT queries are permitted." },
      { status: 400 },
    );
  }

  // Execute the validated query (tenant-scoped). $queryRawUnsafe with positional
  // params keeps user input parameterized; restaurantId scoping comes from the
  // schema context + SAFETY_RULES, and the SELECT-only gate above.
  const rows = await prisma.$queryRawUnsafe(trimmed, ...plan.params);

  // STEP 2 — stream a natural-language answer (unchanged shape, now on Gemini).
  const result = streamText({
    model: aiModel,
    system:
      "You are a restaurant analytics assistant. Answer the user's question " +
      "in plain language using ONLY the provided query results. Be concise.",
    prompt:
      `Question: ${question}\n\n` +
      `Query results (JSON):\n${JSON.stringify(rows)}`,
  });

  return result.toUIMessageStreamResponse();
}
```

**Migration checklist for Feature A**

- [x] `JSON.parse(res.content[0].text)` → `generateObject({ schema: SqlPlan })`.
- [x] `claude-sonnet-4-6` → `gemini-2.5-flash` (via `aiModel`).
- [x] `system` still = `buildSchemaContext(...) + SAFETY_RULES`.
- [x] `"starts with SELECT"` validation retained.
- [x] `prisma.$queryRaw*` execution retained, parameterized.
- [x] Final answer still streamed via `streamText` → `toUIMessageStreamResponse()`.

> **Note:** Gemini's structured output is enabled by default for the Google provider, so `generateObject` works without provider-specific flags. Keep the schema descriptions (`.describe(...)`) — they materially improve output quality because they're sent to the model.

---

## 3. Features B & C — `generateText` on Gemini

These two only ever called `generateText` for free-form prose. The migration is literally a one-line model change per call — **plus** the throttling/quota work in §5, which is mandatory here.

### B) Weekly summary cron

**File:** `src/app/api/cron/weekly-summary/route.ts`

```ts
// src/app/api/cron/weekly-summary/route.ts
import { generateText } from "ai";
import { aiModel } from "@/lib/ai/model";
import { prisma } from "@/lib/prisma";
import { gatherWeeklyMetrics } from "@/lib/analytics/weekly";

// Gemini free tier ≈ 15 requests/min. We loop over ALL restaurants, so we MUST
// pace the calls — see §5(b). 4.5s between calls ≈ 13 req/min, safely under 15.
const THROTTLE_MS = 4_500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  // Vercel Cron auth (unchanged).
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const restaurants = await prisma.restaurant.findMany({ select: { id: true } });

  for (const { id: restaurantId } of restaurants) {
    const metrics = await gatherWeeklyMetrics(restaurantId);

    const { text: summary } = await generateText({
      model: aiBatchModel, // gemini-2.5-flash-lite — more free headroom for the cron loop
      system: "You write concise weekly performance summaries for restaurant owners.",
      prompt:
        `Write a 3-4 sentence summary of this week's performance.\n\n` +
        `Metrics:\n${JSON.stringify(metrics)}`,
    });

    await prisma.weeklySummary.upsert({
      where: { restaurantId_weekStart: { restaurantId, weekStart: metrics.weekStart } },
      update: { content: summary },
      create: { restaurantId, weekStart: metrics.weekStart, content: summary },
    });

    // THROTTLE: stay under the free-tier RPM ceiling. Without this the cron
    // fails partway once you cross ~15 restaurants in a minute.
    await sleep(THROTTLE_MS);
  }

  return Response.json({ ok: true, processed: restaurants.length });
}
```

### C) Inventory alerts

**File:** `src/lib/ai/inventory-alerts.ts`

```ts
// src/lib/ai/inventory-alerts.ts
import { generateText } from "ai";
import { aiModel } from "@/lib/ai/model";

export async function suggestReorders(input: {
  restaurantId: string;
  items: Array<{ name: string; onHand: number; salesVelocity: number }>;
}) {
  // Velocity computed + urgent items filtered upstream (unchanged).
  const urgent = input.items.filter((i) => i.onHand / Math.max(i.salesVelocity, 1) < 3);
  if (urgent.length === 0) return null;

  const { text } = await generateText({
    model: aiModel, // google('gemini-2.5-flash')
    system:
      "You are an inventory planner. Recommend reorder quantities to cover ~2 weeks " +
      "of sales for each urgent item. Be specific and brief.",
    prompt: `Urgent items (name, on hand, daily sales velocity):\n${JSON.stringify(urgent)}`,
  });

  return text;
}
```

> If a *single* request fans out to many items and you'd benefit from structured output (e.g. `[{ item, reorderQty }]` for the UI), prefer `generateObject` with a Zod array schema instead of `generateText`. Same provider, same model — just a more reliable shape.

---

## 4. Free-tier reality

Confirmed mid‑2026 from Google's rate-limit dashboard and corroborating sources. **The free tier is keyed to a Google AI Studio API key with no credit card required.**

| Limit | `gemini-2.5-flash` | `gemini-2.5-flash-lite` |
| --- | --- | --- |
| Requests per minute (RPM) | ~10 | ~15 |
| Requests per day (RPD) | ~250 | ~1,000 |
| Tokens per minute (TPM) | ~250,000 | ~250,000 |

- RPD resets at **midnight Pacific**. **More API keys do not add quota** — limits are enforced per project/account, so key-rotation doesn't raise the ceiling.
- **Pick the model per call site.** Use `gemini-2.5-flash` for the interactive Text-to-SQL chat (better reasoning on multi-join questions) and `gemini-2.5-flash-lite` for the weekly-summary cron (higher free RPM/RPD; writing a short summary is an easy task). This is why the binding is centralized — see `aiModel` / `aiBatchModel` in §1.
- These limits are **tighter than the 2.0 Flash numbers the original plan assumed** (2.0 offered ~15 RPM / ~1,500 RPD / 1M TPM) — but 2.0 Flash is on the deprecation path, so 2.5 is the current, supported choice.

**Is this enough for a portfolio demo?** Yes, for a handful of seeded tenants. Interactive chat is a few requests at a time; the cron runs once a week, throttled. But 2.5's free RPD is low enough (~250 for Flash) that you should add the per-tenant cap in §5(c), and past ~10 tenants consider a paid key.

> ⚠️ **Limits change.** Google revises free-tier quotas and model availability regularly (e.g. Pro models were removed from the free tier in 2026, and individual `-001` snapshots get retired). Treat the table above as a snapshot and re-verify at `https://aistudio.google.com/rate-limit` and the [official rate-limits page](https://ai.google.dev/gemini-api/docs/rate-limits) before depending on a number. If `gemini-2.5-flash` is ever retired, change the single line in `src/lib/ai/model.ts`.

---

## 5. Three implications the rest of the app MUST respect

These are not optional polish. They follow directly from running on a **free, shared-quota** provider, and each one will bite in a specific, predictable way.

### (a) Free-tier data MAY be used to train Google's models — PII boundary

Per Google's [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms):

> **Unpaid (free) tier:** *"Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services"* — and human reviewers may read inputs/outputs.
>
> **Paid tier:** *"Google doesn't use your prompts ... or responses to improve our products."* Paid inputs are retained only briefly for abuse detection / legal compliance.

| | Free tier | Paid tier / Vertex AI |
| --- | --- | --- |
| Prompts + responses used to improve Google products | **Yes** | No |
| May be seen by human reviewers | Yes | No |
| Acceptable for **seeded demo data** | ✅ | ✅ |
| Acceptable for **real customer PII** | ❌ **No** | ✅ |

**Operato implication.** The Text-to-SQL route sends *schema context + query results* to the model. With seeded demo data that's fine. The moment this app holds real diners' or staff PII, the free tier is **not acceptable** — you must move to a **paid Gemini API tier or Vertex AI**, where prompts/responses are contractually *not* used for training. Because we centralized the binding in `src/lib/ai/model.ts`, the production switch is a key/config change, not a code rewrite. **State this explicitly in any deployment runbook.**

### (b) The weekly cron loops over ALL restaurants — you MUST throttle

The cron in §3(B) calls the model **once per restaurant** in a loop — run it on `aiBatchModel` (`gemini-2.5-flash-lite`, ~15 RPM free). With no pacing, the 16th restaurant in a given minute returns a `429` and the cron **fails partway through** — some restaurants get a summary, others silently don't.

The throttle shown in §3(B) is the fix:

```ts
// stay under 15 RPM: 4.5s spacing ≈ 13 req/min
const THROTTLE_MS = 4_500;
await sleep(THROTTLE_MS); // after each generateText call
```

Alternatives if the restaurant count grows large:
- **Chunk** the list and process N per minute with a wait between chunks.
- Add **retry-with-backoff** on `429` so a transient over-limit doesn't abort the run.
- Watch Vercel's function **max duration**: at 4.5s/restaurant, ~120 restaurants ≈ 9 minutes — split across multiple cron invocations or a queue if you exceed the platform timeout.

For a portfolio demo (a few seeded restaurants), simple sequential throttling is sufficient and correct.

### (c) One shared key = one tenant can starve every other tenant

There is a **single** `GOOGLE_GENERATIVE_AI_API_KEY` for the whole app, and the free-tier limits (~10 RPM / ~250 RPD for `gemini-2.5-flash`) are **account-wide**. So a single heavy tenant hammering the Text-to-SQL endpoint can **exhaust the shared daily quota for *every* tenant** — turning a free-tier quota into an **availability** problem, not just a cost one (there's no overage to pay; requests simply start failing for everyone).

**Mitigation: per-tenant rate limiting on the AI endpoints.** Cap each restaurant to N AI queries per day, tracked in the DB, and enforce it before calling the model (see the `enforceAiRateLimit` call in §2).

```prisma
// prisma/schema.prisma  — per-tenant daily AI counter
model AiUsage {
  id           String   @id @default(cuid())
  restaurantId String
  day          DateTime @db.Date          // UTC day bucket
  count        Int      @default(0)
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id])

  @@unique([restaurantId, day])           // one row per tenant per day
  @@index([restaurantId])
}
```

```ts
// src/lib/ai/rate-limit.ts
import { prisma } from "@/lib/prisma";

const DAILY_LIMIT_PER_RESTAURANT = 15; // tune below the global ~250 RPD ceiling (gemini-2.5-flash)

export async function enforceAiRateLimit(restaurantId: string) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);

  // Atomic upsert+increment: create the day row or bump the counter in one query.
  const usage = await prisma.aiUsage.upsert({
    where: { restaurantId_day: { restaurantId, day } },
    create: { restaurantId, day, count: 1 },
    update: { count: { increment: 1 } },
  });

  return {
    ok: usage.count <= DAILY_LIMIT_PER_RESTAURANT,
    used: usage.count,
    limit: DAILY_LIMIT_PER_RESTAURANT,
  };
}
```

Set the per-tenant cap **below** a fair share of the global RPD so no single tenant can monopolize the shared quota (e.g. with ~10 demo tenants, 15/tenant/day = 150 worst-case, under the ~250 RPD `gemini-2.5-flash` ceiling with headroom for the cron). For production — or more tenants — move to a paid key and a fast store (Upstash Redis / sliding window) and add a per-minute cap too, so bursts can't blow the RPM ceiling either.

---

## 6. Interview talking points — model choice

**Why Google Gemini 2.5 Flash for Operato?**

- **Free tier, no credit card.** `gemini-2.5-flash` (~10 RPM / ~250 RPD) plus `gemini-2.5-flash-lite` (~15 RPM / ~1,000 RPD) for batch work — the whole AI feature set runs at **zero cost** for a portfolio demo, the deciding factor for a self-funded showcase. A paid frontier model (Claude Sonnet, GPT-4-class) would bill per token for the same demo. (2.5's free tier is tighter than 2.0's was, but 2.0 Flash is being retired — 2.5 is the current, supported choice.)
- **Fast.** "Flash" is a latency-optimized tier — important for the **streaming** Text-to-SQL answer where time-to-first-token drives perceived responsiveness.
- **Strong at structured JSON + streaming.** The two things this app needs: (1) reliable structured output for the SQL plan via `generateObject`, and (2) clean token streaming for the chat answer. Gemini Flash handles both well, and structured output is on by default in the AI SDK Google provider.
- **Provider-agnostic by design.** Because everything runs through the Vercel AI SDK, the model is a **one-line binding** (`src/lib/ai/model.ts`). I can move to `gemini-2.5-flash-lite`, a paid tier, Vertex AI, or back to Claude without touching feature code. That's the architectural point I'd emphasize: *the abstraction is the deliverable, the provider is a config value.*

**The trade-off (be honest about it):**

- A paid **frontier** model would likely produce more accurate SQL on gnarly multi-join questions and write more polished prose. I traded a slice of peak quality for **zero cost + low latency**, which is the right call for a demo — and the AI SDK abstraction means upgrading is trivial if the use case demands it.
- **Free-tier data is used for training and shares a global quota.** I called these out as first-class constraints (§5): production-with-PII must move to a paid tier / Vertex AI for the data-use contract, the cron must throttle under the free-tier RPM, and per-tenant rate limiting protects shared-quota availability. Naming these trade-offs *before being asked* is the signal that I understand the difference between a demo and a production system.

---

## Sources

- [AI SDK — Google Generative AI provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai)
- [AI SDK Core — generateObject](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object)
- [Gemini API — Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API — Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API — Additional Terms of Service (data use)](https://ai.google.dev/gemini-api/terms)
- [Google AI Studio — live rate-limit dashboard](https://aistudio.google.com/rate-limit)
