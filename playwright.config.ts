import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config.
 *
 * Runs against a real Next dev server on a seeded tenant DB (see prisma/seed.ts) —
 * there is no mock backend. `webServer` boots `npm run dev` for you and reuses one
 * that is already running locally (CI always starts fresh).
 *
 * Chromium only for now — the brief asks for one browser to start with. Add
 * `firefox`/`webkit` projects here once the suite is stable.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // The dashboard's overview page runs real aggregate queries over ~6k seeded orders
  // per tenant against a remote (Neon) Postgres, and Turbopack compiles each route on
  // its first hit — both are slow exactly once, then fast. Several workers hitting
  // fresh routes on the same dev server at once compounds that cold cost, so keep
  // parallelism modest rather than fighting it with ever-longer timeouts.
  workers: process.env.CI ? 1 : 2,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
