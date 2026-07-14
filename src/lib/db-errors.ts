import "server-only";

import { PrismaClientKnownRequestError } from "@/generated/prisma/internal/prismaNamespace";

/**
 * Constraint violations, recognised at BOTH layers.
 *
 * Prisma 7 runs on a driver adapter and no Rust engine, so a constraint violation does
 * NOT reliably arrive as a PrismaClientKnownRequestError with a P-code. It frequently
 * surfaces as a raw DriverAdapterError carrying the Postgres SQLSTATE instead:
 *
 *   deleting a dish that appears in past orders  ->  DriverAdapterError, code "23001"
 *                                                    (NOT PrismaClientKnownRequestError P2003)
 *
 * Checking only for the P-code — the obvious thing, and what the Prisma 6 docs teach —
 * silently misses those, and the handler falls through to a 500 with a Postgres sentence
 * in the log. So check both.
 *
 * SQLSTATEs:
 *   23505 unique_violation
 *   23503 foreign_key_violation   (the referenced row is missing)
 *   23001 restrict_violation      (ON DELETE RESTRICT refused)
 */
/**
 * Digs the SQLSTATE out of whatever Prisma 7 threw.
 *
 * On the driver adapter the useful part is NOT on the error — it is on `error.cause`:
 *
 *   DriverAdapterError { name, cause: { code: "23001", ... }, clientVersion }
 *
 * `error.code` is `undefined`. (Next's dev overlay flattens the cause into the printed
 * error, which makes it look like a top-level `code` — a genuinely misleading trail.)
 */
function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;

  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") return causeCode;
  }

  return undefined;
}

function prismaCode(error: unknown): string | undefined {
  return error instanceof PrismaClientKnownRequestError ? error.code : undefined;
}

/**
 * The name of the constraint Postgres actually rejected the write on.
 *
 * pg puts it on `cause.constraint` — an exact value. Do NOT fall back to searching the
 * error MESSAGE for a column name: that both false-positives (a duplicate email of
 * `slug@x.com` "contains" the string "slug") and false-negatives (a constraint named via
 * `map:` need not mention its columns) — and a false negative here means rethrowing, and
 * a 500 on the precise case this helper exists to turn into a friendly message.
 */
function constraintName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return undefined;
  const name = (cause as { constraint?: unknown }).constraint;
  return typeof name === "string" ? name : undefined;
}

/**
 * A unique index rejected the write.
 *
 * `field` narrows it to one column, so that adding a unique column later cannot make an
 * unrelated collision get reported as (say) "that address is taken".
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  const isUnique = prismaCode(error) === "P2002" || sqlState(error) === "23505";
  if (!isUnique || !field) return isUnique;

  // Prisma's own path tells us the columns outright.
  if (error instanceof PrismaClientKnownRequestError) {
    const target = error.meta?.target;
    if (Array.isArray(target)) return target.includes(field);
    if (typeof target === "string") return target === field || target.includes(field);
  }

  // Driver path: match the CONSTRAINT NAME, which Prisma generates as
  // "<Table>_<col>_key" / "<Table>_<col1>_<col2>_key".
  const name = constraintName(error);
  if (!name) return false;
  return name.split("_").includes(field);
}

/** A foreign key refused the write — including ON DELETE RESTRICT. */
export function isForeignKeyViolation(error: unknown): boolean {
  const code = sqlState(error);
  return prismaCode(error) === "P2003" || code === "23503" || code === "23001";
}

/**
 * The row a write targeted does not exist.
 *
 * This is how a tenant-scoped `update`/`delete` on the compound unique
 * @@unique([id, restaurantId]) reports "not yours, or not there" — the two are
 * indistinguishable, which is exactly what we want: answering differently would tell a
 * caller that an id exists under some OTHER tenant.
 */
export function isNotFound(error: unknown): boolean {
  return prismaCode(error) === "P2025";
}
