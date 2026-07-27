import { expect, test } from "@playwright/test";

import { SEEDED, currentRestaurantId, signIn } from "./helpers";

/**
 * THE highest-value spec. Two real, pre-existing tenants from prisma/seed.ts prove the
 * multi-tenant model actually holds — not just that auth works, but that a member of
 * restaurant A cannot read or write restaurant B's data by changing an id in the URL.
 *
 * Pages 404 on a non-member (see requirePageMember in src/lib/session.ts — an existence
 * oracle would let an attacker walk ids). API routes 403 (see requireMember in
 * src/lib/auth-guard.ts — a browser-facing client needs to tell "log in again" apart
 * from "not yours").
 */

test.describe("tenant isolation", () => {
  test("owner of restaurant A cannot read or write restaurant B", async ({ page, browser }) => {
    // Get restaurant B's real id via its own owner, in a throwaway context so it never
    // shares cookies with the page under test.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await signIn(pageB, SEEDED.dailyGrind.ownerEmail);
    const restaurantBId = currentRestaurantId(pageB);
    await contextB.close();

    // Sign in as restaurant A's owner — this is the session under test.
    await signIn(page, SEEDED.spiceGarden.ownerEmail);
    const restaurantAId = currentRestaurantId(page);
    expect(restaurantAId).not.toBe(restaurantBId);

    // 1) Loading restaurant B's dashboard PAGE directly by URL -> 404, not a redirect
    //    and not a rendered dashboard. requirePageMember() calls notFound().
    const pageResponse = await page.goto(`/${restaurantBId}`);
    expect(pageResponse?.status()).toBe(404);
    // Never leaks restaurant B's name to a non-member.
    await expect(page.getByText(SEEDED.dailyGrind.name)).toHaveCount(0);

    // Same for a page one level deeper.
    const ordersPageResponse = await page.goto(`/${restaurantBId}/orders`);
    expect(ordersPageResponse?.status()).toBe(404);

    // 2) Hitting restaurant B's API directly (read) -> 403, via requireMember.
    const getResp = await page.request.get(`/api/restaurants/${restaurantBId}/customers`);
    expect(getResp.status()).toBe(403);

    const getOrdersResp = await page.request.get(`/api/restaurants/${restaurantBId}/orders`);
    expect(getOrdersResp.status()).toBe(403);

    // 3) A MUTATION against restaurant B's API — placing an order as A's owner — must
    //    also be rejected. requireMember() runs before the handler ever parses the body
    //    (see withTenant in src/lib/auth-guard.ts), so this 403s even with a body that
    //    would otherwise be well-formed.
    const postResp = await page.request.post(`/api/restaurants/${restaurantBId}/orders`, {
      data: {
        type: "TAKEAWAY",
        items: [{ menuItemId: "cabcdabcdabcdabcdabcdabcd", quantity: 1 }],
      },
    });
    expect(postResp.status()).toBe(403);

    // 4) The modules added after this spec was first written — Staff & Shifts and both AI
    //    routes — get the same guard, not a bespoke one. A security review flagged this
    //    exact gap: the guards were verified correct by reading the code, but nothing
    //    regression-tests them, so a future refactor could quietly weaken one and nothing
    //    here would notice.
    const getStaffResp = await page.request.get(`/api/restaurants/${restaurantBId}/staff`);
    expect(getStaffResp.status()).toBe(403);

    const postStaffResp = await page.request.post(`/api/restaurants/${restaurantBId}/staff`, {
      data: { name: "Intruder", role: "WAITER" },
    });
    expect(postStaffResp.status()).toBe(403);

    // The AI route's body is the question as a raw JSON-encoded STRING, not `{question}` —
    // see src/app/api/restaurants/[restaurantId]/ai/query/route.ts.
    const getAiUsageResp = await page.request.get(`/api/restaurants/${restaurantBId}/ai/query`);
    expect(getAiUsageResp.status()).toBe(403);

    const postAiResp = await page.request.post(`/api/restaurants/${restaurantBId}/ai/query`, {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify("What is our revenue?"),
    });
    expect(postAiResp.status()).toBe(403);

    const postAlertResp = await page.request.post(
      `/api/restaurants/${restaurantBId}/inventory/alert`,
    );
    expect(postAlertResp.status()).toBe(403);

    // And restaurant A's own dashboard is still perfectly reachable in the same session —
    // this isn't a broken session, it's a scoped one.
    const ownResponse = await page.goto(`/${restaurantAId}`);
    expect(ownResponse?.status()).toBe(200);
    await expect(page.getByTestId("page-description")).toHaveText(SEEDED.spiceGarden.name);
  });

  test("an unauthenticated request to a tenant API is 401, not 403", async ({ request }) => {
    // A fresh APIRequestContext carries no session cookie at all. requireMember() must
    // tell "not signed in" apart from "signed in but not yours" — see auth-guard.ts.
    const resp = await request.get("/api/restaurants/nonexistent-restaurant-id/customers");
    expect(resp.status()).toBe(401);
  });
});
