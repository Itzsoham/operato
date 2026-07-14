import { Prisma } from "@/generated/prisma/client";

/**
 * Makes Prisma rows safe for JSON.
 *
 * Two types misbehave:
 *   BigInt  — JSON.stringify throws outright ("Do not know how to serialize a BigInt").
 *             Every COUNT(*) and SUM() from $queryRaw comes back as one.
 *   Decimal — money and stock. It has a toJSON() that emits a STRING, so prices silently
 *             arrive in the client as "480" instead of 480.
 *
 * THE TRAP: a replacer does NOT see the original value. JSON.stringify calls toJSON()
 * FIRST and hands the replacer the result — so `value instanceof Prisma.Decimal` is
 * never true, and a replacer written that way looks right and does nothing. The raw
 * value is reachable only through `this[key]`, where `this` is the holder object. That
 * is also why this must be a `function`, not an arrow: an arrow has no `this`.
 *
 * Money becomes a NUMBER. Decimal(10,2) is well inside the range where a double is exact
 * to the paisa. (If a value ever exceeded 2^53, the answer would be a string plus a
 * currency type in the UI — not a bigger float.)
 */
export function serialize<T>(value: T): T {
  // JSON.stringify(undefined) returns undefined (not the string "undefined"), and
  // JSON.parse(undefined) then throws a SyntaxError. A handler that answers with nothing
  // — `ok(await prisma.x.findFirst(...))` on a miss — would 500 instead of returning null.
  if (value === undefined) return value;

  return JSON.parse(
    JSON.stringify(value, function (this: Record<string, unknown>, key, val: unknown) {
      const raw = this[key];
      if (raw instanceof Prisma.Decimal) return raw.toNumber();
      // Fine for COUNT(*)/SUM(); a BigInt past 2^53 would round. If one ever could, the
      // answer is a string, not a bigger float.
      if (typeof val === "bigint") return Number(val);
      return val;
    }),
  ) as T;
}
