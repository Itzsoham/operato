/**
 * Pre-compiles the routes the suite exercises before any test's clock starts.
 *
 * `next dev` (Turbopack) compiles a route lazily on its FIRST request — that compile,
 * not database latency, is what actually costs 10-20s (compare the `next.js:` vs
 * `application-code:` split in the dev server's own request log). Hitting every route
 * once here, unauthenticated, still forces the compile (each page's guard runs
 * `requireSession()`/`requireMember()` — which is itself inside the route module — before
 * it redirects or 401s), so real test assertions aren't the ones paying for it.
 *
 * Deliberately plain `fetch`, not a browser: this only needs to warm the SERVER's
 * module cache, not render anything.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const WARMUP_ID = "warmup-restaurant-id";
const WARMUP_ORDER_ID = "warmup-order-id";

const GET_ROUTES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/onboarding",
  `/${WARMUP_ID}`,
  `/${WARMUP_ID}/orders`,
  `/api/restaurants/${WARMUP_ID}/customers`,
  `/api/restaurants/${WARMUP_ID}/orders`,
  `/api/restaurants/${WARMUP_ID}/orders/${WARMUP_ORDER_ID}`,
  `/api/restaurants/${WARMUP_ID}/menu/items`,
  `/api/restaurants/${WARMUP_ID}/tables`,
];

const POST_ROUTES = [
  `/api/restaurants/${WARMUP_ID}/orders`,
  `/api/restaurants/${WARMUP_ID}/orders/${WARMUP_ORDER_ID}/pay`,
  `/api/restaurants/${WARMUP_ID}/customers`,
];

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok || res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server never became reachable at ${BASE_URL}`);
}

export default async function globalSetup() {
  await waitForServer();

  for (const path of GET_ROUTES) {
    try {
      await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
    } catch {
      // A warm-up miss just means that route compiles on the test's own first hit
      // instead — slower, not wrong. Never fail the whole run over a warm-up request.
    }
  }

  for (const path of POST_ROUTES) {
    try {
      await fetch(`${BASE_URL}${path}`, { method: "POST", redirect: "manual" });
    } catch {
      // see above
    }
  }
}
