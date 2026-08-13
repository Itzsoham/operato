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
 * WHY NOT gemini-2.5-flash, WHICH THIS FILE PINNED UNTIL NOW.
 *
 * `models.list` still returns `gemini-2.5-flash` and `gemini-2.5-flash-lite`, so they look
 * alive — but CALLING either with a newly-issued key returns:
 *
 *   404  "This model models/gemini-2.5-flash is no longer available to new users."
 *
 * That is the exact failure this file's opening comment warned about, and it is nastier
 * than a plain deprecation: listing the models is not a test that you can USE them, and an
 * existing key on an older project keeps working while a fresh one does not. The retirement
 * is per-account, not global. If you ever need to re-pick, probe with a real
 * `:generateContent` call rather than trusting `models.list`.
 */

/**
 * Treats an EMPTY env var as unset, which `??` alone does not — and .env.example ships
 * `GEMINI_MODEL=""`, so anyone who copies it and doesn't fill it in would otherwise send
 * an empty model id to Google and get an opaque 404.
 */
function modelFromEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

/**
 * Interactive text-to-SQL (`/ai/query`). A human is waiting, so latency and instruction
 * following matter more than cost.
 *
 * Defaults to the FLOATING `gemini-flash-latest` alias, which tracks whatever Google
 * currently considers the flagship Flash. That is the point: the retirement above landed
 * without warning, and an alias absorbs the next one without a code change. The tradeoff is
 * real and worth stating — this model's output feeds sql-guard.ts, so Google moving the
 * alias means the text-to-SQL prompt is suddenly running against a model it was never
 * exercised on, with no diff to blame. `GEMINI_MODEL` is the escape hatch: pin a concrete
 * id there (e.g. `gemini-3.6-flash`) to freeze it per environment without a deploy.
 */
export const MODEL_INTERACTIVE = modelFromEnv("GEMINI_MODEL", "gemini-flash-latest");

/**
 * Everything that runs unattended and in bulk: the weekly-summary cron (one call per
 * tenant) and the inventory reorder prose. Cheaper and lighter, because nobody is
 * watching and the volume scales with the tenant count, not with user patience.
 *
 * Same alias treatment, one tier down, overridable separately — the cron's quality bar is
 * lower than the SQL step's, so there is no reason to force them to move together.
 */
export const MODEL_CRON = modelFromEnv("GEMINI_MODEL_CRON", "gemini-flash-lite-latest");

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
