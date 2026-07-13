# Next.js 16 — what differs from your training data

This repo is on **Next.js 16.2.9** (React 19.2.4). Most models were trained on Next 14/15 and will write code that is now **broken**, not merely outdated. This page is the distilled diff, so you don't have to re-read `node_modules/next/dist/docs/02-guides/upgrading/version-16.md` (1200+ lines) on every task.

**If a claim here conflicts with the bundled docs, the bundled docs win.** Cited paths are relative to `node_modules/next/dist/docs/`.

---

## 1. Async request APIs — sync access is REMOVED, not deprecated

Next 15 made these async with a temporary sync fallback. **Next 16 deleted the fallback.**

`params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` are all Promises. Awaiting is mandatory.

```ts
// Route Handler — the second arg's `params` is a Promise
export async function GET(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  const { restaurantId } = await params;
}
```

Prefer the generated typed helper (no import needed — `next dev` / `next build` / `next typegen` emits it globally):

```ts
import type { NextRequest } from "next/server";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/restaurants/[restaurantId]/menu">) {
  const { restaurantId } = await ctx.params;
}
```

Equivalents exist for pages and layouts: `PageProps<"/blog/[slug]">`, `LayoutProps<...>`.

```tsx
export default async function Page(props: PageProps<"/dashboard/[restaurantId]">) {
  const { restaurantId } = await props.params;
  const query = await props.searchParams; // layouts do NOT receive searchParams
}
```

This is why our auth call is `auth.api.getSession({ headers: await headers() })` — the `await` is load-bearing.

> `03-api-reference/03-file-conventions/route.md:80-122`, `page.md:38-99`, `layout.md:60-80`, `02-guides/upgrading/version-16.md:294-305`

## 2. `middleware.ts` → `proxy.ts`

The file and its named export were renamed. There is no `middleware.md` left in the docs — only `proxy.md`.

```ts
// proxy.ts — repo root, or src/proxy.ts alongside src/app/
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = { matcher: ["/dashboard/:path*", "/onboarding"] };
```

`proxy` runs on the **Node.js runtime only** — the runtime is not configurable and `edge` is unsupported. `middleware.ts` still works but is deprecated and is the only way to keep the edge runtime.

Config keys renamed with it: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`, `experimental.middlewarePrefetch` → `experimental.proxyPrefetch`.

> `version-16.md:625-660`, `03-file-conventions/proxy.md`

## 3. Caching

`cacheComponents` is **off** in our `next.config.ts`, which keeps the familiar knobs alive:

- `fetch` is **not cached by default** (same as 15). Opt in with `{ cache: "force-cache" }`.
- Route Handlers are **not cached by default**. Opt a `GET` in with `export const dynamic = "force-static"`.
- `dynamic`, `revalidate`, `fetchCache`, `dynamicParams` still work — but they are **removed if `cacheComponents: true` is ever enabled**. Don't enable it casually.

Renames that bite regardless:

- `revalidateTag(tag)` now needs a **second argument**: `revalidateTag("orders", "max")`. The one-arg form is a TypeScript error.
- `unstable_cacheLife` / `unstable_cacheTag` are stable: `import { cacheLife, cacheTag } from "next/cache"`.
- `unstable_cache` is superseded by `use cache` (which cannot appear directly in a Route Handler body — extract it to a helper).
- `experimental_ppr` and `unstable_rootParams` are gone.

> `version-16.md:455-580`, `02-guides/caching-without-cache-components.md`

## 4. Build & tooling

- **Turbopack is the default** for `next dev` *and* `next build`. A `webpack` key in `next.config.ts` makes `next build` **fail** unless you pass `--webpack`. Don't add one.
- **`next lint` is removed** and the `eslint` key in `next.config.ts` is removed. `next build` no longer lints. Our `npm run lint` calls `eslint` directly — that's correct, leave it.
- `next dev` writes to `.next/dev` (already reflected in `tsconfig.json` `include`).
- Node **20.9+**, TypeScript **5.1+**.

> `version-16.md:106-166`, `964-970`, `1093-1125`

## 5. `next.config.ts` keys that moved or died

| Was | Now |
|---|---|
| `experimental.reactCompiler` | top-level `reactCompiler` ✅ *(ours already is)* |
| `experimental.turbopack` | top-level `turbopack` |
| `experimental.dynamicIO` / `experimental.useCache` / `experimental.ppr` | top-level `cacheComponents` |
| `images.domains` | `images.remotePatterns` |
| `eslint`, `amp`, `serverRuntimeConfig`, `publicRuntimeConfig` | **removed** (`getConfig()` from `next/config` is gone) |

Image defaults also changed (breaking): `minimumCacheTTL` 60s → 4h, `qualities` defaults to `[75]`, local IPs blocked unless `images.dangerouslyAllowLocalIP`.

> `version-16.md:168-200`, `408-431`, `673-916`, `1053-1209`

## 6. Other hard breaks

- **Every parallel-route slot now requires an explicit `default.js`** — the build fails without it.
- `opengraph-image` / `icon` / `apple-icon`: the image function's `params` **and `id`** are now Promises.
- `sitemap`'s `id` from `generateSitemaps` is now a Promise, and a **string** (was a number).
- Next no longer forces `scroll-behavior: smooth` on navigation unless `<html data-scroll-behavior="smooth">`.

> `version-16.md:330-396`, `942-994`

---

## Unchanged — don't "fix" these

`NextRequest` / `NextResponse` still import from `next/server`. Server Actions (`"use server"`) are unchanged. `export const runtime = "nodejs" | "edge"` remains valid in Route Handlers (but not in `proxy`).
