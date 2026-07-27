import { ok } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { AiError } from "@/lib/ai/errors";
import { getInventoryAlert } from "@/lib/ai/inventory-alerts";

/**
 * POST /api/restaurants/[restaurantId]/inventory/alert
 *
 * DELIBERATELY A BUTTON, NOT PAGE LOAD. `getInventoryAlert` calls Gemini whenever there is
 * anything to reorder, and the shared free-tier quota is metered per Google Cloud PROJECT —
 * so wiring this to run automatically every time anyone opens the Inventory page would burn
 * through the daily budget in a handful of page views, long before the per-tenant rate limit
 * even has a chance to matter. Same "AI answers when asked" shape as /ai/query.
 *
 * Any member may trigger it — reading a reorder summary isn't a destructive action.
 */
export const maxDuration = 30;

export const POST = withTenant(async (_req, { restaurantId, userId }) => {
  try {
    const alert = await getInventoryAlert(restaurantId, userId);
    return ok(alert);
  } catch (error) {
    // Same rule as /ai/query: AiError.safeMessage is the only thing safe to show a user.
    if (error instanceof AiError) {
      return Response.json({ error: error.safeMessage }, { status: error.status });
    }
    throw error;
  }
});
