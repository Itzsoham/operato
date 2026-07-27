/**
 * The ONLY place a Gemini model name appears.
 *
 * Model ids are the thing most likely to change under us: Google retires them on a
 * published schedule (the plan originally pinned `gemini-2.0-flash`, which was already on
 * the deprecation path by the time it was written). Scattering the string across the SQL
 * step, the answer step, the weekly cron and the inventory alerts turns a one-line swap
 * into a grep-and-pray. Everything imports from here.
 *
 * There is deliberately no `google(...)` call in this file: the provider reads
 * GOOGLE_GENERATIVE_AI_API_KEY at call time, and constructing a model eagerly at module
 * scope would make importing ANY of these modules fail in an environment without the key
 * (tests, the schema-context unit test, a build step). Callers do `google(MODEL_...)`.
 */

/**
 * Interactive text-to-SQL (`/ai/query`). A human is waiting, so latency and instruction
 * following matter more than cost.
 */
export const MODEL_INTERACTIVE = "gemini-2.5-flash";

/**
 * Everything that runs unattended and in bulk: the weekly-summary cron (one call per
 * tenant) and the inventory reorder prose. Cheaper and lighter, because nobody is
 * watching and the volume scales with the tenant count, not with user patience.
 */
export const MODEL_CRON = "gemini-2.5-flash-lite";

/**
 * QUOTA, AND WHY THE NUMBER BELOW IS SMALL.
 *
 * The free tier is metered per GOOGLE CLOUD PROJECT, not per key — so every tenant, plus
 * the weekly cron, plus local development, all draw on ONE bucket. Published free-tier
 * limits for the Flash family have been in the region of ~10 RPM / ~250 RPD, and Google
 * has cut them more than once.
 *
 * !! RE-VERIFY BEFORE TRUSTING THIS: https://ai.google.dev/gemini-api/docs/rate-limits
 *    The number here is a budget derived from a moving external limit. It was NOT
 *    confirmed against the live quota page while this file was written (no network at
 *    build time), so treat it as a conservative default, not a measurement.
 *
 * The arithmetic that produced DEFAULT_DAILY_QUERIES_PER_TENANT:
 *   - one interactive question costs TWO calls (generateObject for SQL, then generateText
 *     for the prose answer),
 *   - the weekly cron costs one call per tenant per week,
 *   - so N tenants each asking Q questions/day costs 2*N*Q requests/day.
 *   At 25/day/tenant, five active tenants spend 250 requests — the whole assumed daily
 *   budget. That is intentionally tight: the failure mode of guessing high is that ONE
 *   chatty tenant silently denies the AI to every other tenant, including the cron.
 *
 * Override per environment once a paid key is in place.
 */
export const DEFAULT_DAILY_QUERIES_PER_TENANT = 25;
