import { expect, test } from "@playwright/test";

import { SEEDED, currentRestaurantId, randomPhone, signIn } from "./helpers";

/**
 * Order pipeline: place an order through the real "New order" dialog, walk it through
 * the kitchen's status machine (src/lib/orders/service.ts / validations/orders.ts —
 * PENDING -> PREPARING -> READY -> SERVED), settle it, and confirm the payment rolled
 * up onto the attached customer (Customer.totalSpend / visitCount — the whole point of
 * the FOR UPDATE locking in payOrder()).
 *
 * The order is attached to a customer created fresh via the API for this run, so the
 * "before" baseline is known (0 spend, 0 visits) instead of depending on seeded rollups.
 */

test.describe("order pipeline", () => {
  test("create -> advance through kitchen -> pay -> customer rollup", async ({ page }) => {
    await signIn(page, SEEDED.spiceGarden.ownerEmail);
    const restaurantId = currentRestaurantId(page);

    // A fresh customer, known baseline.
    const customerName = `E2E Diner ${Date.now()}`;
    const customerResp = await page.request.post(
      `/api/restaurants/${restaurantId}/customers`,
      { data: { name: customerName, phone: randomPhone() } },
    );
    expect(customerResp.status()).toBe(201);
    const customer = await customerResp.json();
    expect(customer.totalSpend).toBe(0);
    expect(customer.visitCount).toBe(0);

    await page.goto(`/${restaurantId}/orders`);

    // ── place the order via the real dialog ────────────────────────────────────
    await page.getByTestId("new-order-button").click();
    await expect(page.getByTestId("new-order-dialog")).toBeVisible();

    // Attach the customer we just created.
    await page.getByTestId("customer-search-input").fill(customerName);
    await page.getByTestId("customer-search-result").filter({ hasText: customerName }).click();

    // Add one Butter Chicken — a seeded, always-available Spice Garden main.
    await page.getByTestId("dish-search-input").fill("Butter Chicken");
    await page.getByRole("button", { name: "Add one Butter Chicken" }).click();

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith(`/api/restaurants/${restaurantId}/orders`),
      ),
      page.getByTestId("place-order-submit").click(),
    ]);
    expect(createResp.status()).toBe(201);
    const order = await createResp.json();
    expect(order.status).toBe("PENDING");
    expect(order.customer?.id).toBe(customer.id);

    // Dialog closes on success.
    await expect(page.getByTestId("new-order-dialog")).toBeHidden();

    // ── advance through the kitchen ─────────────────────────────────────────────
    await page.getByTestId("tab-open").click();
    const card = page.getByTestId("order-card").filter({ hasText: order.orderNumber });
    await expect(card).toHaveAttribute("data-status", "PENDING");

    for (const next of ["PREPARING", "READY", "SERVED"] as const) {
      await Promise.all([
        page.waitForResponse(
          (res) =>
            res.request().method() === "PATCH" &&
            res.url().endsWith(`/api/restaurants/${restaurantId}/orders/${order.id}`) &&
            res.status() === 200,
        ),
        card.getByTestId("advance-order-button").click(),
      ]);
      await expect(card).toHaveAttribute("data-status", next);
    }

    // ── pay ──────────────────────────────────────────────────────────────────────
    const [payResp] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith(`/api/restaurants/${restaurantId}/orders/${order.id}/pay`),
      ),
      card.getByTestId("pay-order-button").click(),
    ]);
    expect(payResp.status()).toBe(200);
    const paid = await payResp.json();
    expect(paid.status).toBe("PAID");

    // Paying drops the order off the kitchen's open list.
    await expect(page.getByTestId("order-card").filter({ hasText: order.orderNumber })).toHaveCount(0);

    // ...and it now shows up, settled, in history.
    await page.getByTestId("tab-history").click();
    const historyCard = page.getByTestId("order-card").filter({ hasText: order.orderNumber });
    await expect(historyCard).toHaveAttribute("data-status", "PAID");

    // ── verify the customer rollup ──────────────────────────────────────────────
    const afterResp = await page.request.get(
      `/api/restaurants/${restaurantId}/customers?search=${encodeURIComponent(customerName)}`,
    );
    expect(afterResp.status()).toBe(200);
    const matches = await afterResp.json();
    const updated = matches.find((c: { id: string }) => c.id === customer.id);
    expect(updated).toBeTruthy();
    expect(updated.totalSpend).toBeCloseTo(paid.totalAmount, 2);
    expect(updated.visitCount).toBe(1);
  });

  test("cannot pay an order before it has been prepared", async ({ page }) => {
    await signIn(page, SEEDED.dailyGrind.ownerEmail);
    const restaurantId = currentRestaurantId(page);

    await page.goto(`/${restaurantId}/orders`);
    await page.getByTestId("new-order-button").click();
    await expect(page.getByTestId("new-order-dialog")).toBeVisible();

    await page.getByTestId("dish-search-input").fill("Cappuccino");
    await page.getByRole("button", { name: "Add one Cappuccino" }).click();

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith(`/api/restaurants/${restaurantId}/orders`),
      ),
      page.getByTestId("place-order-submit").click(),
    ]);
    const order = await createResp.json();
    expect(order.status).toBe("PENDING");

    // The server enforces this regardless of what the UI offers — PENDING has no Pay
    // button (see canPay in orders-client.tsx), so this hits /pay directly.
    const payResp = await page.request.post(
      `/api/restaurants/${restaurantId}/orders/${order.id}/pay`,
    );
    expect(payResp.status()).toBe(409);
  });
});
