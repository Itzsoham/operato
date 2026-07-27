/**
 * Failures the AI path can produce, carrying the HTTP status the route should return.
 *
 * Same shape as InventoryError / OrderError so `route-builder` maps it the same way, and
 * NOT a `Response` — see the note on AuthError: a thrown Response is an unhandled error in
 * a Next route handler, which turns a 429 into a 500 with a stack trace.
 *
 * `safeMessage` is the part that may be shown to a user. Everything else (the model's SQL,
 * the Postgres error text) stays in `cause` for the server log: a database error message
 * can name columns and tables, and echoing it back to the browser hands an attacker a free
 * schema-discovery oracle on the one endpoint that runs model-authored SQL.
 */
export class AiError extends Error {
  constructor(
    readonly status: 400 | 422 | 429 | 500 | 503,
    /** Safe to show a user. Never interpolate model output or driver errors into this. */
    readonly safeMessage: string,
    options?: { cause?: unknown },
  ) {
    super(safeMessage, options);
    this.name = "AiError";
  }
}

/** Thrown by the static pre-filter. Kept distinct so it can be counted/alerted on: a spike
 *  means either a bad prompt or someone probing the boundary. */
export class UnsafeSqlError extends AiError {
  constructor(
    /** Which rule fired. Server-side only — do not echo to the client. */
    readonly reason: string,
  ) {
    super(422, "The assistant could not turn that into a safe query. Try rephrasing.");
    this.name = "UnsafeSqlError";
  }
}

export class RateLimitError extends AiError {
  constructor(
    readonly limit: number,
    readonly used: number,
  ) {
    super(
      429,
      `You've used all ${limit} AI questions for today. The limit resets on a rolling 24-hour window.`,
    );
    this.name = "RateLimitError";
  }
}
