import { UnsafeSqlError } from "@/lib/ai/errors";
import { listAllowedIdentifiers } from "@/lib/ai/schema-context";

/**
 * ══════════════════════════════════════════════════════════════════════════════════
 *  THIS FILE IS A CHEAP PRE-FILTER. IT IS **NOT** THE SECURITY BOUNDARY.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Nothing here is what makes the text-to-SQL path safe. If every rule below were deleted,
 * the path would still be contained, because the actual controls live in the database:
 *
 *   1. the `operato_ai_ro` role holds SELECT and nothing else       (src/lib/db.ts)
 *   2. the transaction is READ ONLY with a statement_timeout        (run-readonly-sql.ts)
 *   3. Row-Level Security keyed off `app.restaurant_id` decides which rows exist at all
 *      (prisma/migrations/20260714062642_rls_and_ai_grants)
 *   4. column-level grants keep Customer PII unreadable             (..._customer_phone_and_ai_pii)
 *
 * What this file buys is: a clear error instead of a Postgres permission failure, a
 * cheaper failure (no round trip), and a second, independent reason for the obvious
 * attacks to fail. A startsWith("SELECT") check presented as security is exactly the
 * theatre that docs/plan-code-review.md Finding 3 exists to condemn — so this filter must
 * never be described as the reason the path is safe, in a code review or anywhere else.
 *
 * It is deliberately FAIL-CLOSED and deliberately over-broad. A menu item literally named
 * "Grant", or a note containing a double hyphen, will be rejected. That is the correct
 * trade: a rephrase costs a user five seconds, and every relaxation here is a rule someone
 * has to re-audit.
 *
 * Pure on purpose — no `server-only`, no `PrismaClient`, no network — so tests/unit can
 * hammer it with adversarial fixtures. It does import the generated Prisma ENUM OBJECTS
 * (via schema-context.ts's `listAllowedIdentifiers`) — static string data with no client,
 * no connection, and no I/O, so this stays synchronous and side-effect-free. See
 * tests/unit/ai-sql-guard.test.ts.
 */

/** Long enough for a five-table join with a CTE; short enough that nothing pathological
 *  reaches the planner. An LLM emitting 4kB of SQL has misunderstood the question. */
const MAX_SQL_LENGTH = 4_000;

/**
 * Statement keywords that have no place in an analytics SELECT.
 *
 * `returning` is in the list even though `insert|update|delete` already are: a
 * data-modifying CTE is the specific attack Finding 3 calls out
 * (WITH x AS (DELETE ... RETURNING *) SELECT * FROM x), and it is worth two independent
 * rules — plus `transaction_read_only = on`, which is the one that actually stops it.
 */
const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|analyze|reindex|cluster|comment|refresh|call|execute|prepare|deallocate|listen|notify|lock|merge|returning|savepoint|rollback|commit|begin|declare|fetch|discard|reset|import|definer|into)\b/i;

/**
 * Every `pg_*` identifier, wholesale.
 *
 * Enumerating `pg_sleep|pg_read` (as the spec sketch does) misses the ones that matter
 * most. `pg_stat_activity` is the standing worry — RLS does not cover system views, so
 * anything it leaks is a cross-tenant leak all four database-level controls would allow.
 * Verified on THIS database: Postgres itself already hides the `query` column from a
 * non-superuser role for any session but its own (`<insufficient privilege>`), so that
 * specific "reads another tenant's query text" scenario does not fire here — but the view
 * still exposes `pid`, `application_name`, `client_addr`, `state`, `wait_event` and query
 * *start time* for every session regardless of role, which is process-topology information
 * this role has no business handing to a model either. `pg_sleep` is a DoS, `pg_read_file`
 * is filesystem access, `pg_catalog` is schema discovery.
 *
 * Nothing in this schema, and nothing in any legitimate analytics query, starts with
 * `pg_` — so blanket rejection costs nothing and closes the whole family, including the
 * members added in the next Postgres release.
 */
const SYSTEM_IDENTIFIER = /\bpg_\w+/i;

const INFORMATION_SCHEMA = /\binformation_schema\b/i;

/**
 * THE TENANT-PIVOT VECTOR. Not in the spec's keyword list, and it defeats RLS outright.
 *
 * RLS reads the tenant from current_setting('app.restaurant_id', true), which
 * run-readonly-sql.ts sets via set_config(..., is_local => true). set_config is an
 * ordinary function, callable from inside a plain SELECT, and it is NOT a data write — so
 * the read-only role, the read-only transaction and the LIMIT wrapper all permit it:
 *
 *   SELECT * FROM "Order" WHERE set_config('app.restaurant_id','victim-id',true) <> 'x'
 *
 * That re-points the RLS policy at another tenant mid-query. Blocked here, and — because
 * this filter is not the boundary — ALSO caught after execution by the GUC re-assertion in
 * run-readonly-sql.ts, which fails the request if the setting moved.
 *
 * NO trailing `\(` requirement (an earlier version had `\s*\(` here). That gap was a real,
 * verified bypass: `"set_config"(...)` — the identifier double-quoted — has a `"`
 * immediately after the name, not whitespace, so `\s*\(` never matched while the bare
 * substring, and therefore the RLS-defeating call, still executed. A bare `\b...\b` still
 * matches inside the quotes (a `"` is a non-word character, so the boundary is still
 * there), and the ALLOWLIST below closes the rest of this family regardless of spelling.
 */
const GUC_TAMPERING = /\b(set_config|current_setting)\b/i;

/**
 * `U&"..."` is Postgres's UNICODE-ESCAPED identifier syntax — a second, independent way to
 * spell a double-quoted identifier where each character can be written as an escape
 * (`\+000073` for 's', etc.), so the identifier's literal text NEVER APPEARS in the SQL
 * string at all. `U&"\0073et_config"` calls set_config without the substring "set_config"
 * existing anywhere for a keyword rule to find — it defeats GUC_TAMPERING, SYSTEM_IDENTIFIER
 * and DYNAMIC_SQL simultaneously, and it defeats the ALLOWLIST below too (the allowlist
 * matches literal text, and this has none to match). There is no legitimate reason a
 * generated analytics query over this schema — plain ASCII table/column names throughout —
 * ever needs this syntax, so it is rejected outright rather than decoded and checked.
 */
const UNICODE_ESCAPE_IDENTIFIER = /u&"/i;

/**
 * Functions that execute a SQL STRING from inside an ordinary SELECT — a hole straight
 * through every keyword rule above, since the payload is a literal this filter cannot see
 * into. query_to_xml('SELECT ... pg_stat_activity ...', ...) is the canonical example.
 */
const DYNAMIC_SQL =
  /\b(dblink\w*|query_to_xml\w*|table_to_xml\w*|schema_to_xml\w*|database_to_xml\w*|xmltable)\b/i;

/** Dollar-quoting has no use in generated analytics SQL and exists here only as an
 *  obfuscation wrapper. Matches both the anonymous and the tagged form. */
const DOLLAR_QUOTE = /\$\w*\$/;

/**
 * Every double-quoted identifier IN THE SCHEMA — table names, and every column name of
 * every table the model can see (schema-context.ts's allowlist, which is itself the exact
 * subset the database grants permit). Anything else in double quotes is not a real schema
 * reference, however it's spelled, so it is rejected — this is what makes the check an
 * ALLOWLIST rather than one more blacklist entry to keep re-auditing.
 */
const ALLOWED_IDENTIFIERS = listAllowedIdentifiers();

/**
 * Pulls out the contents of every double-quoted run, ignoring a `"` that appears inside a
 * SINGLE-quoted string literal (e.g. `'He said "hi"'` is text, not an identifier).
 *
 * No special case for a doubled `""` escape, for the same reason `scan()` below doesn't
 * need one: no real column or table name in this schema contains a literal quote
 * character, so anything that produces one — by splitting on a doubled quote or otherwise
 * — is already guaranteed not to be on the allowlist, whichever half of the split gets
 * checked.
 */
function extractQuotedIdentifiers(sql: string): string[] {
  const found: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let current = "";

  for (const char of sql) {
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (char === '"') {
        inDouble = false;
        found.push(current);
        current = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
  }

  return found;
}

/** Only these two may open the statement. Deliberately stricter than SQL allows — a
 *  top-level (SELECT ...) or `TABLE "Order"` is valid Postgres and simply never comes out
 *  of the prompt, so allowing it would widen the surface for nothing. */
const STATEMENT_START = /^(select|with)\b/i;

type ScanResult = {
  /** Paren depth at the end. Non-zero means the model's SQL cannot be wrapped safely. */
  depth: number;
  /** Lowest depth reached. Below zero means it closed a paren it never opened. */
  minDepth: number;
  /** A quote was still open at end of input. */
  unterminated: boolean;
};

/**
 * Walks the string tracking quote state, so parentheses inside string literals don't count.
 *
 * WHY PARENTHESES ARE A SECURITY CONCERN HERE. The executor wraps the model's SQL as
 *
 *     SELECT * FROM ( <sql> ) AS _q LIMIT 1000
 *
 * and that wrapper is only a wrapper if <sql> is paren-balanced. Given
 * `SELECT 1) AS x, (SELECT 2`, the concatenation becomes
 *
 *     SELECT * FROM ( SELECT 1) AS x, (SELECT 2 ) AS _q LIMIT 1000
 *
 * — perfectly valid SQL with a shape nobody intended, in which the model's text has broken
 * OUT of the subquery it was supposed to be sealed inside. Rejecting `minDepth < 0` and
 * `depth !== 0` makes that concatenation structurally impossible rather than merely
 * unlikely.
 *
 * Postgres escapes a quote inside a quoted string by doubling it. That needs no special
 * case here: the first quote closes the literal and the second immediately reopens it,
 * which lands on the same state either way.
 */
function scan(sql: string): ScanResult {
  let depth = 0;
  let minDepth = 0;
  let inSingle = false;
  let inDouble = false;

  for (const char of sql) {
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (char === '"') inDouble = false;
      continue;
    }
    if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < minDepth) minDepth = depth;
    }
  }

  return { depth, minDepth, unterminated: inSingle || inDouble };
}

/**
 * Validates model-authored SQL and returns the NORMALISED string to execute.
 *
 * Always execute the RETURN VALUE, never the input. The trailing-semicolon strip below is
 * the only difference between them, and validating one string while running another is the
 * classic TOCTOU shape — so the executor takes what this returns.
 *
 * @throws {UnsafeSqlError} carrying a server-side `reason`. The message shown to the user
 *   is deliberately generic: naming the rule that fired turns this into a filter oracle.
 */
export function assertLooksLikeSafeSelect(rawSql: string): string {
  if (typeof rawSql !== "string") throw new UnsafeSqlError("not a string");

  /**
   * Strip trailing whitespace and AT MOST ONE trailing semicolon.
   *
   * Models emit `SELECT ...;` constantly, and rejecting that outright would fail a large
   * share of otherwise perfect queries. Stripping exactly one TRAILING semicolon cannot
   * create a second statement — there is nothing after it to run — while every other
   * semicolon still trips the rule below. `SELECT 1; DROP TABLE "Order";` loses its final
   * semicolon and is rejected on the one that remains in the middle.
   */
  const sql = rawSql.trim().replace(/;\s*$/, "").trim();

  if (sql.length === 0) throw new UnsafeSqlError("empty");
  if (sql.length > MAX_SQL_LENGTH) throw new UnsafeSqlError("too long");

  // Stacked statements. After the single trailing-semicolon strip, ANY remaining semicolon
  // means a second statement was attempted.
  if (sql.includes(";")) throw new UnsafeSqlError("statement separator");

  // Comments are how keyword filters get walked past, so they are rejected wherever they
  // appear rather than parsed around.
  if (sql.includes("--")) throw new UnsafeSqlError("line comment");
  if (sql.includes("/*") || sql.includes("*/")) throw new UnsafeSqlError("block comment");

  if (DOLLAR_QUOTE.test(sql)) throw new UnsafeSqlError("dollar quoting");

  // Unicode-escaped identifiers can spell ANY name (set_config, pg_stat_activity, ...)
  // without its literal text ever appearing — no keyword rule below can see through this,
  // so it is rejected outright rather than decoded. See UNICODE_ESCAPE_IDENTIFIER.
  if (UNICODE_ESCAPE_IDENTIFIER.test(sql)) throw new UnsafeSqlError("unicode-escaped identifier");

  // No legitimate generated analytics query over this schema needs a literal backslash —
  // Postgres string literals don't require one, and this closes any escape-based identifier
  // or literal trick that doesn't already have its own named rule.
  if (sql.includes("\\")) throw new UnsafeSqlError("backslash");

  // Exactly one statement, and it reads.
  if (!STATEMENT_START.test(sql)) throw new UnsafeSqlError("does not start with SELECT/WITH");

  const keyword = FORBIDDEN_KEYWORDS.exec(sql);
  if (keyword) throw new UnsafeSqlError(`forbidden keyword: ${keyword[1]}`);

  if (SYSTEM_IDENTIFIER.test(sql)) throw new UnsafeSqlError("pg_* system identifier");
  if (INFORMATION_SCHEMA.test(sql)) throw new UnsafeSqlError("information_schema");
  if (GUC_TAMPERING.test(sql)) throw new UnsafeSqlError("session setting tampering");
  if (DYNAMIC_SQL.test(sql)) throw new UnsafeSqlError("dynamic SQL function");

  // THE ALLOWLIST. Every double-quoted identifier must be a real table/column name the
  // model was actually taught — closes the whole family of "quote a forbidden name" tricks
  // (set_config, pg_stat_activity, query_to_xml, ...) in one rule instead of one entry per
  // function anyone thinks to enumerate. See ALLOWED_IDENTIFIERS.
  for (const identifier of extractQuotedIdentifiers(sql)) {
    if (!ALLOWED_IDENTIFIERS.has(identifier)) {
      throw new UnsafeSqlError("unknown quoted identifier");
    }
  }

  const { depth, minDepth, unterminated } = scan(sql);
  if (unterminated) throw new UnsafeSqlError("unterminated string literal");
  if (minDepth < 0) throw new UnsafeSqlError("closes a parenthesis it did not open");
  if (depth !== 0) throw new UnsafeSqlError("unbalanced parentheses");

  return sql;
}

/**
 * Non-throwing form, for tests and for anywhere a boolean reads better than a try/catch.
 * It delegates, so the two can never drift apart.
 */
export function looksLikeSafeSelect(sql: string): boolean {
  try {
    assertLooksLikeSafeSelect(sql);
    return true;
  } catch {
    return false;
  }
}
