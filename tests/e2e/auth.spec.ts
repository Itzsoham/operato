import { expect, test } from "@playwright/test";

import { DEMO_PASSWORD, SEEDED, randomEmail, signIn } from "./helpers";

/**
 * Auth coverage: a brand-new account through onboarding to a live dashboard, and
 * sign-in for an account that already has one. Every spec that needs a session
 * (tenant-isolation, order-pipeline) reuses `signIn` from ./helpers, so if the sign-in
 * form's contract ever changes this file is the one that catches it first.
 */

test.describe("auth", () => {
  test("sign up -> onboarding -> create a restaurant -> dashboard", async ({ page }) => {
    const email = randomEmail("signup");

    await page.goto("/sign-up");
    await page.getByTestId("sign-up-name").fill("E2E Test User");
    await page.getByTestId("sign-up-email").fill(email);
    await page.getByTestId("sign-up-password").fill("a-very-secure-password-1");
    await page.getByTestId("sign-up-submit").click();

    // A brand-new user has no restaurant yet -> onboarding, not the dashboard. The
    // redirect is server-side (RootPage -> /onboarding) after the sign-up POST, which
    // itself hits an uncompiled Turbopack route on a cold run — give it room.
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });
    // CardTitle renders a styled <div>, not a semantic heading (see src/components/ui/card.tsx)
    // — assert on the text itself rather than a role that never applies here.
    await expect(page.getByText("Set up your restaurant", { exact: true })).toBeVisible();

    const restaurantName = `E2E Kitchen ${Date.now()}`;
    await page.getByTestId("onboarding-name").fill(restaurantName);
    // Leave the slug as auto-derived from the name (it's unique per run via the timestamp).
    await page.getByTestId("onboarding-submit").click();

    // createRestaurant() redirects straight to `/{restaurantId}` on success.
    await expect(page.getByTestId("page-title")).toHaveText("Overview", { timeout: 45_000 });
    await expect(page.getByTestId("page-description")).toHaveText(restaurantName);
  });

  test("sign in with an existing seeded owner reaches their dashboard", async ({ page }) => {
    await signIn(page, SEEDED.spiceGarden.ownerEmail, DEMO_PASSWORD);

    await expect(page.getByTestId("page-title")).toHaveText("Overview");
    await expect(page.getByTestId("page-description")).toHaveText(SEEDED.spiceGarden.name);
  });

  test("wrong password is rejected with a vague, non-enumerating error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByTestId("sign-in-email").fill(SEEDED.spiceGarden.ownerEmail);
    await page.getByTestId("sign-in-password").fill("definitely-the-wrong-password");
    await page.getByTestId("sign-in-submit").click();

    await expect(page.getByTestId("sign-in-error")).toBeVisible();
    // Still on the sign-in page — no session was created.
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
