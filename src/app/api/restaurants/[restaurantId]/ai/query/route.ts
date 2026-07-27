import { ok, parseJson } from "@/lib/api";
import { withTenant } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { AiError } from "@/lib/ai/errors";
import { getAiUsage } from "@/lib/ai/rate-limit";
import { answerQuestion } from "@/lib/ai/text-to-sql";
import { aiQuestionSchema } from "@/lib/validations/ai";

/**
 * Two sequential Gemini calls (SQL generation, then the prose answer) plus a database round
 * trip for the generated SQL — not instant, but nowhere near the loop in the weekly-summary
 * cron. Matches this codebase's own convention of setting `maxDuration` explicitly on routes
 * with real work (see orders/route.ts) rather than trusting the platform default.
 */
export const maxDuration = 30;

/**
 * POST /api/restaurants/[restaurantId]/ai/query
 *
 * Any member role may ask a question — this isn't a destructive action, and gating it by
 * role would just be friction for staff who want a quick number. `withTenant` (no `roles`
 * option) is exactly `requireMember`, so that's the guard here.
 *
 * The body is the question itself, validated with `aiQuestionSchema` from
 * `src/lib/validations/ai.ts` — the same one `assistant-client.tsx` validates against
 * client-side, per this codebase's one-schema-per-route-input convention.
 */
export const POST = withTenant(async (req, { restaurantId, userId }) => {
  // Every calendar-boundary question ("this week", "yesterday") in the generated SQL is
  // anchored to the tenant's own timezone, never the server's.
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { timezone: true },
  });

  const parsed = await parseJson(req, aiQuestionSchema);
  if (!parsed.ok) return parsed.response;

  try {
    // Single-turn Q&A, not a multi-turn chat — the non-streaming entry point returns the
    // full answer (including the SQL, rows, and usage) as one JSON value. No `useChat` /
    // streaming machinery needed for a feature with no conversation history.
    const answer = await answerQuestion({
      restaurantId,
      userId,
      timezone: restaurant.timezone,
      question: parsed.data,
    });
    return ok(answer);
  } catch (error) {
    // AiError.safeMessage is deliberately the ONLY thing safe to show a user — never
    // error.cause or any raw driver/model text. On the one endpoint that runs
    // model-authored SQL, an echoed database error is a schema-discovery oracle.
    if (error instanceof AiError) {
      return Response.json({ error: error.safeMessage }, { status: error.status });
    }
    throw error;
  }
});

/**
 * GET /api/restaurants/[restaurantId]/ai/query
 *
 * Lets the client show "12/25 questions used today" without spending one — no model call,
 * just a count against AiQuery. `answerQuestion` already calls `checkAiRateLimit` internally
 * before spending any quota, so there is no separate rate-limit check to duplicate here.
 */
export const GET = withTenant(async (_req, { restaurantId }) => {
  const usage = await getAiUsage(restaurantId);
  return ok(usage);
});
