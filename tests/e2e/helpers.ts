import { expect, type Page } from "@playwright/test";

/**
 * Fixture data from `prisma/seed.ts`. Read that file before changing anything here —
 * these constants must track it exactly (emails, slugs, password). The seed is
 * idempotent (`npm run db:seed`), so these two tenants always exist.
 */
export const DEMO_PASSWORD = "operato-demo-1234";

export const SEEDED = {
  spiceGarden: {
    slug: "spice-garden",
    name: "Spice Garden",
    ownerEmail: "owner@spicegarden.test",
  },
  dailyGrind: {
    slug: "the-daily-grind",
    name: "The Daily Grind",
    ownerEmail: "owner@dailygrind.test",
  },
} as const;

/**
 * Signs in through the real UI (not an API shortcut) and waits for the post-login
 * redirect to land on a tenant dashboard. Every spec that needs a session goes
 * through here so the sign-in flow itself stays exercised by every other test too.
 */
export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByTestId("sign-in-email").fill(email);
  await page.getByTestId("sign-in-password").fill(password);
  await page.getByTestId("sign-in-submit").click();

  // RootPage redirects `/` -> `/{restaurantId}` server-side; wait for the dashboard's
  // own content rather than a URL shape, since a cuid pattern is an implementation detail.
  // Generous timeout: the overview page runs real aggregate queries over the seeded
  // orders against a remote Postgres, and is slow on an uncompiled (Turbopack) route.
  await expect(page.getByTestId("page-title")).toHaveText("Overview", { timeout: 45_000 });
}

/** The tenant id currently in the URL, e.g. `/cmabc123.../orders` -> `cmabc123...`. */
export function currentRestaurantId(page: Page): string {
  const path = new URL(page.url()).pathname;
  const id = path.split("/").filter(Boolean)[0];
  if (!id) throw new Error(`Could not read a restaurantId out of ${page.url()}`);
  return id;
}

/** A fresh, collision-free email for tests that create their own account. */
export function randomEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** A fresh, collision-free Indian mobile number for tests that create their own customer. */
export function randomPhone(): string {
  const digits = String(9_000_000_000 + Math.floor(Math.random() * 999_999_999)).slice(0, 10);
  return `+91${digits}`;
}
