import "server-only";

import Razorpay from "razorpay";

/**
 * Thrown when a caller reaches for Razorpay before it is configured — a missing
 * RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET, or (from getProPlanId()) a missing
 * RAZORPAY_PRO_PLAN_ID. This is a legitimate "not wired up yet" state (the Pro plan is
 * created once per environment, by hand, in the Razorpay dashboard — there is no
 * plans.create() call in this codebase), not a bug. Routes should catch this specifically
 * and answer with a 503, the same distinction db.ts draws for a missing DATABASE_URL_AI.
 */
export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new BillingConfigError(
      `Billing is not configured: missing ${name}. Set it in the environment before using Razorpay.`,
    );
  }
  return value;
}

declare global {
  var __razorpay: Razorpay | undefined;
}

/**
 * Lazily-constructed singleton Razorpay client.
 *
 * LAZY ON PURPOSE — same reasoning as getAiPrisma() in db.ts. This module can be reached
 * by code paths that have nothing to do with checkout (a dashboard page just reading
 * `restaurant.plan` off the database, say), so constructing the client eagerly at module
 * scope would crash every one of those pages the moment RAZORPAY_KEY_ID/SECRET are unset,
 * not just the checkout flow that actually needs them. Cached on `globalThis` rather than
 * a module-level `let` for the same reason db.ts does: Next's dev server hot-reloads
 * modules, and a plain module-level variable would not survive that, quietly rebuilding
 * the client (and, for a real PrismaClient, leaking a connection) on every reload.
 */
export function getRazorpay(): Razorpay {
  globalThis.__razorpay ??= new Razorpay({
    key_id: requiredEnv("RAZORPAY_KEY_ID"),
    key_secret: requiredEnv("RAZORPAY_KEY_SECRET"),
  });
  return globalThis.__razorpay;
}

/**
 * The public Key ID, server-validated before being handed back in a JSON body.
 * Checkout.js needs it in the browser by design — Razorpay Key IDs are not secret, so
 * returning it here avoids requiring a second, duplicate NEXT_PUBLIC_RAZORPAY_KEY_ID env
 * var just to plumb the same value to the client a different way.
 */
export function getKeyId(): string {
  return requiredEnv("RAZORPAY_KEY_ID");
}

/**
 * The shared "Operato Pro" plan id, created once per environment in the Razorpay
 * dashboard. Missing is a legitimate, expected state before that one-time setup step has
 * happened — callers should turn this into a 503, not a 500.
 */
export function getProPlanId(): string {
  return requiredEnv("RAZORPAY_PRO_PLAN_ID");
}

/**
 * The ONE string a Razorpay failure is allowed to put in an HTTP response body.
 *
 * Deliberately fixed, not derived from the error. Both places this is used
 * (customers.create / subscriptions.create in billing/checkout/route.ts) fail for
 * merchant-side reasons — bad API credentials, a missing plan, Razorpay being down — never
 * for anything the person clicking "Upgrade" can act on. Payer-facing errors ("card
 * declined") happen inside Checkout.js, not here. So the alternatives to a fixed string
 * are all worse: `error.description` on a credentials failure reads "Authentication
 * failed", which is useless to the owner and a credential-state signal to anyone else, and
 * the SDK's own normalizer (`razorpay/dist/api.js` does `err.response.data.error` with no
 * guard) throws a raw `TypeError: Cannot read properties of undefined` on any transport
 * failure, which is a straight internals leak. The real detail goes to the server log via
 * `razorpayErrorDetail`.
 */
export const BILLING_UNAVAILABLE_MESSAGE =
  "Couldn't reach the payment provider just now. Please try again in a few minutes.";

/**
 * The same error, formatted for a SERVER LOG — never for a response body.
 *
 * Razorpay's Node SDK rejects with an `INormalizeError`-shaped value,
 * `{ statusCode, error: { code, description, ... } }`, NOT a JS `Error` instance — so the
 * usual `error.message` reads `undefined` on exactly the failures worth debugging. This
 * prefers Razorpay's own `description`, then falls back to a real Error's message (which
 * is what a transport-level failure produces), so whoever reads the log gets something
 * actionable either way.
 */
export function razorpayErrorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null && "error" in error) {
    const inner = (error as { error?: unknown }).error;
    if (typeof inner === "object" && inner !== null && "description" in inner) {
      const description = (inner as { description?: unknown }).description;
      if (typeof description === "string") return description;
    }
  }
  if (error instanceof Error) return error.message;
  return "Razorpay request failed.";
}
