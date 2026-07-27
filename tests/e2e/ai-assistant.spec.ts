import { expect, test } from "@playwright/test";

import { SEEDED, currentRestaurantId, signIn } from "./helpers";

/**
 * AI query flow: the flagship text-to-SQL assistant
 * (src/components/assistant/assistant-client.tsx). This spec never talks to Gemini —
 * there is no GOOGLE_GENERATIVE_AI_API_KEY in this environment anyway, and even if there
 * were, hitting a live, quota-limited model on every run would be flaky and wasteful.
 * Instead it intercepts `/api/restaurants/[restaurantId]/ai/query` (both the GET usage
 * check and the POST ask, per src/hooks/use-ai.ts) and fulfills it with a canned response
 * matching the documented contract. This is the real frontend against a fake backend —
 * the backend (text-to-SQL generation, the read-only role, RLS) has its own audited
 * unit/live coverage; this spec's job is only proving the UI renders what that contract
 * promises.
 */

const aiQueryUrl = (restaurantId: string) => `**/api/restaurants/${restaurantId}/ai/query`;

function waitForAiPost(page: import("@playwright/test").Page, restaurantId: string) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().endsWith(`/api/restaurants/${restaurantId}/ai/query`),
  );
}

test.describe("ai assistant", () => {
  test("happy path: mocked answer renders, usage updates, SQL/explanation expand", async ({
    page,
  }) => {
    await signIn(page, SEEDED.spiceGarden.ownerEmail);
    const restaurantId = currentRestaurantId(page);

    const question = "What were our top 5 dishes by revenue this month?";
    const mockedAnswer = {
      question,
      sql:
        'SELECT mi.name, SUM(oi.quantity * oi."priceAtOrder") AS revenue FROM "OrderItem" oi ' +
        'JOIN "MenuItem" mi ON mi.id = oi."menuItemId" WHERE oi."restaurantId" = $1 ' +
        "GROUP BY mi.name ORDER BY revenue DESC LIMIT 5",
      explanation:
        "Sums each order item's quantity times its price at the time of the order, grouped " +
        "by dish for this restaurant only, and returns the top 5 by that total.",
      rows: [
        { name: "Butter Chicken", revenue: 48250 },
        { name: "Paneer Tikka", revenue: 31200 },
        { name: "Garlic Naan", revenue: 21800 },
      ],
      truncated: false,
      answer:
        "Your top 5 dishes by revenue this month are Butter Chicken (Rs 48,250), Paneer " +
        "Tikka (Rs 31,200), and Garlic Naan (Rs 21,800), among others.",
      usage: { used: 3, limit: 25, remaining: 22 },
    };

    // GET (usage on mount, and again after the POST invalidates it) and POST (the ask
    // itself) share one URL, so a single handler branches on method. `asked` flips once
    // the mocked POST fires so the follow-up GET reflects the "spent" quota, just like the
    // real route would.
    let asked = false;
    await page.route(aiQueryUrl(restaurantId), async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        const usage = asked
          ? { used: 3, limit: 25, remaining: 22 }
          : { used: 2, limit: 25, remaining: 23 };
        await route.fulfill({ status: 200, json: usage });
        return;
      }
      if (req.method() === "POST") {
        asked = true;
        await route.fulfill({ status: 200, json: mockedAnswer });
        return;
      }
      await route.continue();
    });

    await page.goto(`/${restaurantId}/assistant`);

    // Initial usage indicator, from the mocked GET fired on mount.
    await expect(page.getByTestId("ai-usage-indicator")).toHaveText(
      "23 of 25 questions left today",
    );

    await page.getByTestId("ai-question-input").fill(question);

    const [postResp] = await Promise.all([
      waitForAiPost(page, restaurantId),
      page.getByTestId("ai-ask-button").click(),
    ]);
    expect(postResp.status()).toBe(200);

    // The rendered answer.
    await expect(page.getByTestId("ai-answer-text")).toHaveText(mockedAnswer.answer);

    // Usage indicator refetches (invalidated onSettled) and reflects the mocked count.
    await expect(page.getByTestId("ai-usage-indicator")).toHaveText(
      "22 of 25 questions left today",
    );

    // No truncated badge on a non-truncated answer.
    await expect(page.getByTestId("ai-truncated-badge")).toHaveCount(0);

    // "How this was calculated" is collapsed by default...
    await expect(page.getByTestId("ai-explanation-text")).toBeHidden();
    // ...expanding it reveals the mocked SQL and explanation.
    await page.getByTestId("ai-explanation-toggle").click();
    await expect(page.getByTestId("ai-explanation-text")).toHaveText(mockedAnswer.explanation);
    await expect(page.getByTestId("ai-sql-text")).toHaveText(mockedAnswer.sql);

    // The rows table renders the mocked rows.
    const rowsTable = page.getByTestId("ai-rows-table");
    await expect(rowsTable).toBeVisible();
    await expect(rowsTable.getByRole("cell", { name: "Butter Chicken" })).toBeVisible();
    await expect(rowsTable.getByRole("cell", { name: "48250" })).toBeVisible();
  });

  test("rate limited: 429 surfaces a toast, not a silent failure or raw error", async ({
    page,
  }) => {
    await signIn(page, SEEDED.spiceGarden.ownerEmail);
    const restaurantId = currentRestaurantId(page);

    // The real safeMessage from RateLimitError in src/lib/ai/errors.ts.
    const rateLimitMessage =
      "You've used all 25 AI questions for today. The limit resets on a rolling 24-hour window.";

    let asked = false;
    await page.route(aiQueryUrl(restaurantId), async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        const usage = asked
          ? { used: 25, limit: 25, remaining: 0 }
          : { used: 24, limit: 25, remaining: 1 };
        await route.fulfill({ status: 200, json: usage });
        return;
      }
      if (req.method() === "POST") {
        asked = true;
        await route.fulfill({ status: 429, json: { error: rateLimitMessage } });
        return;
      }
      await route.continue();
    });

    await page.goto(`/${restaurantId}/assistant`);
    await expect(page.getByTestId("ai-usage-indicator")).toHaveText(
      "1 of 25 questions left today",
    );

    await page.getByTestId("ai-question-input").fill("How many orders did we take yesterday?");

    const [postResp] = await Promise.all([
      waitForAiPost(page, restaurantId),
      page.getByTestId("ai-ask-button").click(),
    ]);
    expect(postResp.status()).toBe(429);

    // Surfaced as a toast (useAskAi's onError -> toast.error) with the exact safe message —
    // never a raw stack trace or a silently swallowed failure.
    await expect(page.locator("[data-sonner-toast]")).toContainText(rateLimitMessage);

    // No answer was produced — no answer card rendered, not a broken/partial one.
    await expect(page.getByTestId("ai-answer-card")).toHaveCount(0);

    // The usage indicator still refetches on a failed ask (onSettled, not onSuccess) and
    // now reflects the quota being fully spent.
    await expect(page.getByTestId("ai-usage-indicator")).toHaveText(
      "Used all 25 questions today, more tomorrow.",
    );
    await expect(page.getByTestId("ai-ask-button")).toBeDisabled();
  });

  test("truncated result shows the sample-of-data badge", async ({ page }) => {
    await signIn(page, SEEDED.spiceGarden.ownerEmail);
    const restaurantId = currentRestaurantId(page);

    const mockedAnswer = {
      question: "List every order this year",
      sql: 'SELECT id, "orderNumber" FROM "Order" WHERE "restaurantId" = $1 LIMIT 200',
      explanation:
        "Capped at 200 rows to keep the query fast; this is a sample, not the full set.",
      rows: [
        { id: "ord_1", orderNumber: "SG-1001" },
        { id: "ord_2", orderNumber: "SG-1002" },
      ],
      truncated: true,
      answer: "Here is a sample of this year's orders, there are more than fit in one view.",
      usage: { used: 4, limit: 25, remaining: 21 },
    };

    await page.route(aiQueryUrl(restaurantId), async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        await route.fulfill({ status: 200, json: { used: 3, limit: 25, remaining: 22 } });
        return;
      }
      if (req.method() === "POST") {
        await route.fulfill({ status: 200, json: mockedAnswer });
        return;
      }
      await route.continue();
    });

    await page.goto(`/${restaurantId}/assistant`);
    await page.getByTestId("ai-question-input").fill(mockedAnswer.question);

    await Promise.all([
      waitForAiPost(page, restaurantId),
      page.getByTestId("ai-ask-button").click(),
    ]);

    await expect(page.getByTestId("ai-answer-text")).toHaveText(mockedAnswer.answer);
    await expect(page.getByTestId("ai-truncated-badge")).toHaveText(
      "Based on a sample of the data",
    );
  });
});
