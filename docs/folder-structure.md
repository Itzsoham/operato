# Folder Structure

This document is the canonical project layout for **Operato**, a multi-tenant AI SaaS for restaurants built on Next.js 16 (App Router, RSC, streaming) with TypeScript strict mode.

All application code lives under **`/src`** (`src/app`, `src/components`, `src/lib`, `src/hooks`, `src/types`). Everything else — `prisma/`, `tests/`, `public/`, and the root config files — stays at the repository root.

It also records exactly how this layout differs from the **original plan**, which put `app/`, `components/`, `lib/`, `hooks/`, and `types/` at the repo root and assumed Clerk + Stripe + Anthropic Claude. Operato instead uses **Better Auth** (replaces Clerk), **Razorpay** (replaces Stripe), and **Google Gemini 2.5 Flash via the Vercel AI SDK** (replaces Anthropic Claude). The stack swap removes, replaces, and renames a few files; the multi-tenant dashboard shape is unchanged.

---

## 1. Target tree

Everything that was application code moves under `src/`. The Next.js `app` router lives at `src/app`. Config files, `public/`, `prisma/`, and `tests/` stay at the root.

```text
operato/
├── prisma/                              # stays at root (Prisma convention)
│   ├── schema.prisma                   # domain models + Better Auth tables (User/Session/Account/Verification)
│   ├── seed.ts
│   └── migrations/                     # generated: includes the Better Auth tables migration
│
├── tests/                              # stays at root
│   └── e2e/                            # Playwright specs
│
├── public/                            # stays at root (Next.js requires this)
│
├── src/                               # ALL application code lives here
│   ├── app/                           # App Router (Next.js resolves this as the app dir)
│   │   ├── (auth)/
│   │   │   ├── sign-in/
│   │   │   │   └── page.tsx           # OWN page (Better Auth) — replaces Clerk catch-all
│   │   │   └── sign-up/
│   │   │       └── page.tsx           # OWN page (Better Auth) — replaces Clerk catch-all
│   │   │
│   │   ├── (marketing)/                # public site — no auth, static, SEO'd
│   │   │   ├── layout.tsx             # marketing nav + footer (no dashboard chrome)
│   │   │   ├── page.tsx               # public landing page (operato.app)
│   │   │   └── pricing/
│   │   │       └── page.tsx           # Free vs Pro (Razorpay upgrade CTA)
│   │   │
│   │   ├── onboarding/
│   │   │   └── page.tsx               # create first restaurant / membership
│   │   │
│   │   ├── dashboard/
│   │   │   └── [restaurantId]/        # tenant-scoped; shape UNCHANGED from original plan
│   │   │       ├── layout.tsx         # single auth + ownership check (Better Auth session)
│   │   │       ├── page.tsx           # overview
│   │   │       ├── menu/
│   │   │       │   └── page.tsx
│   │   │       ├── orders/
│   │   │       │   ├── page.tsx
│   │   │       │   └── history/
│   │   │       │       └── page.tsx
│   │   │       ├── inventory/
│   │   │       │   └── page.tsx
│   │   │       ├── customers/
│   │   │       │   ├── page.tsx
│   │   │       │   └── [customerId]/
│   │   │       │       └── page.tsx
│   │   │       ├── staff/
│   │   │       │   └── page.tsx
│   │   │       └── ai/
│   │   │           └── page.tsx       # text-to-SQL assistant UI (streaming)
│   │   │
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   └── [...all]/
│   │   │   │       └── route.ts       # NEW — Better Auth catch-all handler
│   │   │   ├── webhooks/
│   │   │   │   └── razorpay/
│   │   │   │       └── route.ts       # RENAMED from stripe; raw-body signature verify
│   │   │   ├── cron/
│   │   │   │   └── weekly-summary/
│   │   │   │       └── route.ts       # Vercel Cron target
│   │   │   └── restaurants/
│   │   │       └── [restaurantId]/
│   │   │           ├── menu/
│   │   │           │   └── route.ts
│   │   │           ├── orders/
│   │   │           │   └── route.ts
│   │   │           ├── inventory/
│   │   │           │   └── route.ts
│   │   │           ├── customers/
│   │   │           │   └── route.ts
│   │   │           ├── staff/
│   │   │           │   └── route.ts
│   │   │           └── ai/
│   │   │               ├── query/
│   │   │               │   └── route.ts   # text-to-SQL, streams Gemini output
│   │   │               └── summary/
│   │   │                   └── route.ts
│   │   │
│   │   ├── layout.tsx                 # root layout
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── ui/                        # Shadcn primitives
│   │   ├── marketing/                 # landing hero, feature blocks, pricing table, FAQ, CTA
│   │   ├── menu/
│   │   ├── orders/
│   │   ├── inventory/
│   │   ├── customers/
│   │   ├── staff/
│   │   ├── ai/                        # chat / streaming components
│   │   └── charts/                    # Recharts wrappers
│   │
│   ├── lib/
│   │   ├── db.ts                      # Prisma client (Neon serverless)
│   │   ├── auth.ts                    # NEW — Better Auth server instance (replaces Clerk auth.ts)
│   │   ├── auth-client.ts             # NEW — Better Auth client (createAuthClient)
│   │   ├── razorpay.ts                # NEW — Razorpay SDK instance + helpers
│   │   ├── ai/                        # KEPT — now targets Gemini via @ai-sdk/google
│   │   │   ├── text-to-sql.ts
│   │   │   ├── schema-context.ts
│   │   │   ├── weekly-summary.ts
│   │   │   └── inventory-alerts.ts
│   │   ├── verticals/
│   │   │   └── restaurant.ts
│   │   ├── validations/               # Zod schemas
│   │   └── utils.ts
│   │
│   ├── hooks/
│   │   ├── use-restaurant.ts
│   │   └── use-ai-stream.ts
│   │
│   └── types/
│       └── index.ts
│
├── package.json                       # root
├── tsconfig.json                      # root — paths alias updated to "@/*": ["./src/*"]
├── next.config.ts                     # root
├── components.json                    # root — Shadcn aliases point into src/
├── vercel.json                        # root — Cron schedule for weekly-summary
└── .env                               # root
```

> `dnd-kit`, `TanStack Query`, and `Uploadthing` are dependencies (in `package.json`) rather than folders; their usage shows up inside `src/components/*`, `src/hooks/*`, and `src/lib/*`.

---

## 2. Stack-swap deltas, in place

These are the structural consequences of swapping Clerk to Better Auth, Stripe to Razorpay, and Anthropic Claude to Gemini. Each is reflected in the tree above.

### Better Auth replaces Clerk

- **Removed:** `app/api/webhooks/clerk/`. With Clerk, a webhook synced Clerk users into your DB. Better Auth owns the user tables directly (it writes `User`/`Session`/`Account`/`Verification` through the Prisma adapter), so **no user-sync webhook exists** and the directory is deleted entirely.
- **Replaced:** the Clerk `[[...sign-in]]` / `[[...sign-up]]` catch-all pages become your **own** `sign-in/page.tsx` and `sign-up/page.tsx` that call the Better Auth client.
- **Added:** a single Better Auth catch-all **handler** at `src/app/api/auth/[...all]/route.ts`. This one route serves every auth endpoint (`/api/auth/sign-in`, `/sign-up`, `/session`, OAuth callbacks, etc.).

```typescript
// src/app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

`auth` is the server instance defined in `src/lib/auth.ts`, wired to Prisma:

```typescript
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()], // must be LAST in the plugins array
});
```

The matching client (used by the sign-in/sign-up pages and `use-restaurant`-style hooks):

```typescript
// src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // baseURL is inferred from the current origin in the browser;
  // set it explicitly if calling from server components or a different origin.
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

> API note: the recommended catch-all path is `/api/auth/[...all]` and `toNextJsHandler` is exported from `better-auth/next-js`. Better Auth's API surface evolves between releases — verify against the version pinned in `package.json` before copying.

### Razorpay replaces Stripe

- **Renamed:** `app/api/webhooks/stripe/route.ts` becomes `src/app/api/webhooks/razorpay/route.ts`.
- **Added:** `src/lib/razorpay.ts` holds the SDK instance and order/verification helpers.

```typescript
// src/lib/razorpay.ts
import Razorpay from "razorpay";

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});
```

The webhook must verify the `X-Razorpay-Signature` header against the **raw** request body (HMAC-SHA256 with the webhook secret). Do not parse the body before verifying — App Router gives you the raw body via `await req.text()`, which sidesteps the classic `express.json()` mismatch bug.

```typescript
// src/app/api/webhooks/razorpay/route.ts
import { validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils";

export async function POST(req: Request) {
  const body = await req.text(); // RAW body — required for a valid signature
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const valid = validateWebhookSignature(
    body,
    signature,
    process.env.RAZORPAY_WEBHOOK_SECRET!,
  );
  if (!valid) return new Response("Invalid signature", { status: 400 });

  const event = JSON.parse(body);
  // ...handle payment.captured / subscription events, scoped by restaurantId
  return new Response("ok");
}
```

> API note: `validateWebhookSignature` is exported from `razorpay/dist/utils/razorpay-utils` in the Node SDK. That deep import path has shifted across SDK versions; if it fails to resolve, fall back to a manual `crypto.createHmac("sha256", secret).update(body).digest("hex")` comparison.

### Gemini (Vercel AI SDK) replaces Anthropic Claude

- **Kept:** `src/lib/ai/` with the same four files (`text-to-sql.ts`, `schema-context.ts`, `weekly-summary.ts`, `inventory-alerts.ts`). The folder shape is identical to the plan — only the provider import and model id change.

```typescript
// src/lib/ai/text-to-sql.ts
import { google } from "@ai-sdk/google"; // reads GOOGLE_GENERATIVE_AI_API_KEY
import { streamText } from "ai";

export function streamSqlAnswer(prompt: string, system: string) {
  return streamText({
    model: google("gemini-2.5-flash"),
    system,
    prompt,
  });
}
```

> API note: the Google provider is `@ai-sdk/google`; `streamText` comes from `ai`. The default model factory `google(...)` reads `GOOGLE_GENERATIVE_AI_API_KEY` from the environment (use `createGoogleGenerativeAI({ apiKey })` to pass it explicitly). The text-to-SQL safety rules from the original plan are unchanged: the model returns a parameterised `SELECT` only, tables are whitelisted, and `restaurantId` is always injected as a bound parameter from the URL — never interpolated.

---

## 3. What changed vs the original plan

| Path before | Path after | Why |
|---|---|---|
| `app/` | `src/app/` | App Router moved under `src/`; Next.js resolves `src/app` as the app directory. |
| `components/` | `src/components/` | Application code consolidated under `src/`. |
| `lib/` | `src/lib/` | Same. |
| `hooks/` | `src/hooks/` | Same. |
| `types/` | `src/types/` | Same. |
| `prisma/` | `prisma/` (unchanged) | Prisma convention; stays at root. |
| `tests/e2e/` | `tests/e2e/` (unchanged) | Test root stays at repo root. |
| `public/` | `public/` (unchanged) | Next.js requires `public/` at the project root. |
| `package.json`, `tsconfig.json`, `next.config.ts`, `components.json`, `vercel.json`, `.env` | unchanged (root) | Config files must stay at the project root. |
| `app/(auth)/sign-in/[[...sign-in]]/page.tsx` (Clerk) | `src/app/(auth)/sign-in/page.tsx` (own page) | Better Auth uses your own forms via the auth client, not Clerk catch-all UI. |
| `app/(auth)/sign-up/[[...sign-up]]/page.tsx` (Clerk) | `src/app/(auth)/sign-up/page.tsx` (own page) | Same. |
| _(none)_ | `src/app/api/auth/[...all]/route.ts` | New Better Auth catch-all handler serving all auth endpoints. |
| `app/api/webhooks/clerk/route.ts` | **removed** | Better Auth writes user tables directly; no user-sync webhook needed. |
| `app/api/webhooks/stripe/route.ts` | `src/app/api/webhooks/razorpay/route.ts` | Payments swapped Stripe to Razorpay; raw-body signature verify. |
| `app/api/cron/weekly-summary/route.ts` | `src/app/api/cron/weekly-summary/route.ts` | Path moved under `src/`; Vercel Cron target unchanged. |
| `app/api/restaurants/[restaurantId]/...` | `src/app/api/restaurants/[restaurantId]/...` | Moved under `src/`; resource routes (menu, orders, inventory, customers, staff, ai/query, ai/summary) unchanged in shape. |
| `app/dashboard/[restaurantId]/...` | `src/app/dashboard/[restaurantId]/...` | Moved under `src/`; tenant routing and ownership check unchanged in shape. |
| `lib/auth.ts` (Clerk) | `src/lib/auth.ts` (Better Auth server) | Provider swap; same filename, new implementation. |
| _(none)_ | `src/lib/auth-client.ts` | Better Auth needs an explicit client module (`createAuthClient`). |
| _(none)_ | `src/lib/razorpay.ts` | Razorpay SDK instance + order/verify helpers. |
| `lib/ai/*` (Claude) | `src/lib/ai/*` (Gemini) | Folder kept; provider import switched to `@ai-sdk/google`. |
| `lib/db.ts`, `lib/verticals/restaurant.ts`, `lib/validations/`, `lib/utils.ts` | same paths under `src/lib/` | Moved under `src/`; unchanged otherwise. |

---

## 4. Notes

### tsconfig path alias

Because application code now lives under `src/`, the TypeScript path alias must point into `src/`:

```jsonc
// tsconfig.json (root)
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

This keeps every `@/lib/...`, `@/components/...`, `@/hooks/...`, `@/types/...` import working unchanged after the move. `components.json` (Shadcn) and the Tailwind `content` globs must likewise resolve into `src/` (e.g. `./src/**/*.{ts,tsx}`).

### Next.js supports `/src` and resolves `app/` from it

Next.js officially supports placing application code under `src/`: you move the App Router folder to `src/app` and it is detected automatically. The documented rules:

- `public/` must remain at the project **root**.
- Config files (`package.json`, `next.config.ts`, `tsconfig.json`) and `.env.*` files remain at the **root**.
- **`src/app` is ignored if an `app` directory exists at the root** — so do not keep a root-level `app/` once you adopt `src/app`, or the root one wins.
- If you use TypeScript `@/*` paths, update `tsconfig.json` to include `src/` (see above).

(Verified against the pinned **Next.js 16.2.9**; the `src` resolution rules have been stable across 15/16.)

> **Next 16:** the root-level gate file is **`proxy.ts`**, not `middleware.ts` — under `src/` that means `src/proxy.ts`, alongside `src/app/`. See [nextjs-16-notes.md](nextjs-16-notes.md).

### Where Better Auth's tables and migration live

Better Auth does **not** introduce a separate folder. With the Prisma adapter, its models live **inside `prisma/schema.prisma`** alongside your domain models. The Better Auth CLI's `generate` command writes the required models (`User`, `Session`, `Account`, `Verification`) into `prisma/schema.prisma`; you then create a normal Prisma migration:

```bash
npx @better-auth/cli generate   # writes Better Auth models into prisma/schema.prisma
npx prisma migrate dev          # produces prisma/migrations/<timestamp>_*/
```

So the tables are defined in `prisma/schema.prisma` and the SQL ships as one of the standard files under `prisma/migrations/` — there is no dedicated auth directory. In this multi-tenant model, the `RestaurantMember` table links Better Auth's `User` to a `Restaurant` (membership), and every domain table carries `restaurantId`.

### Dashboard shape and the ownership check are unchanged

The tenant-scoped dashboard keeps its exact original structure: `src/app/dashboard/[restaurantId]/` with a `layout.tsx` performing a **single** auth + ownership check, then `page.tsx` plus `menu/`, `orders/` (+`history/`), `inventory/`, `customers/` (+`[customerId]/`), `staff/`, and `ai/`. The only difference is that `layout.tsx` reads the session from Better Auth (`auth.api.getSession`) instead of Clerk; the routing tree, the `[restaurantId]` segment, and the one-place ownership gate are identical to the plan. The same holds for `src/app/api/restaurants/[restaurantId]/...` — `restaurantId` always comes from the URL and is bound as a SQL parameter, never taken from the request body.

---

## Sources

- [Next.js — src Folder](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder)
- [Next.js — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)
- [Better Auth — Next.js integration](https://better-auth.com/docs/integrations/next)
- [Better Auth — Prisma adapter](https://better-auth.com/docs/adapters/prisma)
- [Better Auth — CLI](https://better-auth.com/docs/concepts/cli)
- [Better Auth — Database](https://better-auth.com/docs/concepts/database)
- [Vercel AI SDK — Google Generative AI provider](https://vercel-ai.mintlify.app/providers/ai-sdk-providers/google-generative-ai)
- [Razorpay — Validate and Test Webhooks](https://razorpay.com/docs/webhooks/validate-test/)
- [Razorpay — Node.js SDK integration steps](https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/)
- [Gemini API — Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)

> External library APIs and free-tier limits change over time. As of mid-2026, `gemini-2.5-flash`'s free tier is roughly **~10 RPM / ~250 RPD / ~250K TPM** (and `gemini-2.5-flash-lite` ~15 RPM / ~1,000 RPD) at the project level — tighter than the retiring 2.0 Flash. Confirm current numbers in the Gemini rate-limits docs before relying on them.
