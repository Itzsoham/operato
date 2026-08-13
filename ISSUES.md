# Operato — open issues

Every known open item in one place. [STATUS.md](STATUS.md) says what is *built*; this says
what is *wrong, missing, or unverified*. Nothing here is a surprise — each entry is either a
deliberate deferral or something found by review and not yet closed.

Closed issues are not listed. If it was found and fixed, it lives in STATUS.md's history.

**Legend — who can close it:**
🔑 needs an account/credential (only you can do this) · 🛠 needs code · 📋 needs a decision

---

## 1. Blockers — nothing ships past these

| # | Issue | Impact | Close it by |
|---|---|---|---|
| B1 | 🔑 **Razorpay test keys return `401 Unauthorized`** | The entire billing surface is unverifiable. Code is complete and reviewed; not one line of it has been exercised against a live account | Regenerate the pair in Dashboard → Settings → API Keys, copying **both halves from the same generation**. Confirm with a bare `curl -u KEY_ID:KEY_SECRET https://api.razorpay.com/v1/plans` returning 200 *before* touching the app |
| B2 | 🔑 **`RAZORPAY_PRO_PLAN_ID` unset** | `POST /billing/checkout` answers 503. Deliberate — a clean "not configured", not a crash | Create the Pro plan once in the Razorpay dashboard, put its `plan_…` id in `.env`. Blocked on B1 |
| B3 | 🔑 **`RAZORPAY_WEBHOOK_SECRET` unset** | The webhook rejects everything (fails closed, correctly). Plan upgrades would never land. Also keeps 4 E2E specs skipped | Needs a public URL first — it is a value *you choose* in Dashboard → Settings → Webhooks, not the key secret. Set it, then `npm run test:e2e` |
| B4 | 🔑 **Never deployed** | No production origin exists, which is itself what blocks B3 and A2 | Vercel project → env vars → both crons (`vercel.json` already declares them) |

## 2. Deploy prerequisites

| # | Issue | Impact | Close it by |
|---|---|---|---|
| A1 | 🔑 `BETTER_AUTH_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL` still point at `localhost:3000` | Auth breaks entirely in production. Better Auth pins `trustedOrigins` to this value, so a wrong one fails *closed* — noisy, not silent | Set both to the real origin |
| A2 | 🔑 Google OAuth redirect URI not registered for production | The Google sign-in button 400s in prod. Only `http://localhost:3000/api/auth/callback/google` is registered | Add the prod callback in Google Cloud Console |
| A3 | 🔑 `CRON_SECRET` unset | Both cron routes fail closed. Not a security hole — it means the weekly summary and the Razorpay reconciliation **silently never run** | Generate one, set it in Vercel |
| A4 | 🔑 `UPLOADTHING_TOKEN` unset | Menu image upload is fully wired but non-functional | Create an Uploadthing account |
| A5 | 🔑 **Rotate the Neon password and the Google client secret** | Both were pasted into chat in earlier sessions and must be considered compromised | Rotate in Neon + Google Cloud Console, update everywhere |

## 3. Security debt

| # | Issue | Impact | Close it by |
|---|---|---|---|
| S1 | 🔑🛠 **Better Auth rate limiter is in-memory** | On serverless it is per-lambda and resets on every cold start, so sign-in is effectively **open to credential stuffing**. This is the most serious open security item | Give it `secondaryStorage` (Upstash Redis). *Deferred by explicit choice — needs a new external service* |
| S2 | 🔑🛠 **Email verification not required** | Anyone can register any address. Harmless today; becomes an account-takeover primitive the day team-invite-by-email ships | `requireEmailVerification: true` + a send hook (Resend). *Deferred by explicit choice — needs a new external service* |
| S3 | 🛠 `npm audit`: postcss + sharp HIGH, transitive via `next` | Build-time only, not in the request path | Wait for the upstream bump. **Do not** `npm audit fix --force` — it resolves to `next@9` and `uploadthing@6` |
| S4 | 📋 Neon cannot `REVOKE EXECUTE ... FROM PUBLIC` on `set_config` | The DB-level backstop against an RLS pivot does not exist. `set_config` is owned by Neon's internal `cloud_admin`, and Postgres **no-ops a REVOKE from a non-owner with a WARNING, not an error** — so the migration appeared to succeed and did nothing | Accepted. The code-level guard in `sql-guard.ts` is the real control, and `verify:ai-boundary` asserts this state explicitly rather than pretending otherwise |

## 4. Correctness / design gaps

| # | Issue | Impact | Close it by |
|---|---|---|---|
| C1 | 📋 **`Restaurant.plan` gates no features** | PRO is currently cosmetic — a badge and a 409 guard on re-checkout. Grep confirms the only reads are `checkout/route.ts` and the billing badge. Worth knowing because two other issues (C2, the ordering guard) are "bounded" only *because* nothing depends on `plan` yet | Decide what PRO actually unlocks, then re-read the ordering/reconcile guarantees with that blast radius in mind |
| C2 | 🛠 **No cancel or downgrade path in the app** | An owner can upgrade but cannot stop paying from Operato — they have to cancel in Razorpay's own dashboard or email you. The webhook *handles* `subscription.cancelled` correctly; there is simply no UI or route that initiates one | Add a `DELETE`/cancel route calling `subscriptions.cancel()` (OWNER-only), and a button behind a confirm |
| C3 | 🛠 Model alias tradeoff on the SQL path | `MODEL_INTERACTIVE` defaults to the floating `gemini-flash-latest`, so Google can move it under a text-to-SQL prompt that was never exercised against the new model — on a security-sensitive path, with no diff to blame | Pin a concrete id in `GEMINI_MODEL` for production. Chosen deliberately: an alias absorbs the next surprise retirement (see C4), which has already happened once |
| C4 | 📋 Gemini model retirement is **per-account and invisible to `models.list`** | `gemini-2.5-flash` still lists but 404s on a fresh key — this cost a full debugging cycle and presented as a flat 503 with nothing useful logged | Documented in `models.ts`, `AGENTS.md`, and the ai-engineer agent. **Always probe with a real `:generateContent` call before pinning a model** |

## 5. Test coverage debt

| # | Issue | Impact | Close it by |
|---|---|---|---|
| T1 | 🛠 `staff/service.ts`'s `clockIn`/`clockOut` untested | The `FOR UPDATE` serialisation (double-clock-in prevention, future-`startTime` guard, Decimal `hoursWorked`) has zero coverage. This is money — payroll hours | Needs a real Postgres connection to exercise the lock, the way `order-pipeline.spec.ts` does for `payOrder`. A Playwright spec that clocks a seeded member in twice and asserts a 409 |
| T2 | 🛠 `ai/weekly-summary.ts`'s `runWeeklySummaries` untested | The time-budget cutoff, the 8-day skip pre-filter, the idempotent-upsert short-circuit (**the whole reason the function exists** — it's what stops a retried cron from re-spending a Gemini call), and per-tenant error isolation are all unverified | `generateWeeklySummary` is a same-module direct reference, so mocking it needs a small refactor first (split it out, or make it an injectable option) — not just a test file |
| T3 | 🔑 4 Razorpay webhook E2E specs skip themselves | The dedupe/replay guarantees are proven by design and by unit tests, but the DB-backed half only runs when a secret exists | Resolves itself the moment B3 is closed — the specs are written and self-enable |
| T4 | 📋 E2E suite is mildly flaky under parallelism | Two `order-pipeline` specs failed once in a full parallel run and both passed in isolation. Diagnosed as dev-server contention during Turbopack cold compiles, not a regression | Accepted; `workers: 2` already limits it. Re-run a failing spec alone before treating it as real |

## 6. Product / UX

| # | Issue | Impact | Close it by |
|---|---|---|---|
| P1 | 📋 Menu image field keeps a raw-URL fallback input | Looks like an unfinished form next to the Uploadthing button | Intentional — it lets you re-attach an existing upload without re-uploading. Remove only if that stops being useful |
| P2 | 🛠 Billing page has no invoice/payment history | An owner can see their plan and renewal date, nothing else | Razorpay holds the invoices; surface them via `invoices.all({ subscription_id })` if it's ever asked for |

---

## What is NOT an issue

Worth stating, because each looks like one:

- **`ProcessedWebhook` rows created before the dedupe-key migration hold header event ids, not body hashes.** Harmless: a SHA-256 can never collide with an `evt_…` id. Worst case is one pre-migration event being reprocessed if Razorpay redelivers it.
- **The webhook acks 200 on a payload shape it doesn't recognise.** Deliberate. Razorpay retries non-2xx for ~24h, and retrying cannot fix a shape mismatch — a 400 would just spin the webhook for a day.
- **`reconcile.ts` runs an unfiltered cross-tenant `findMany`.** The one correct exception to the tenant-filter rule: it is a server-to-server sweep behind `CRON_SECRET`, with no user in the request.
- **The checkout route returns the Razorpay Key ID in its JSON body.** Key IDs are public by Razorpay's design — Checkout.js takes one in the browser. This deliberately avoids a duplicate `NEXT_PUBLIC_*` env var, which would be a footgun (see STATUS.md).
