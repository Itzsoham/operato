import "server-only";

import { getAiPrisma } from "@/lib/db";
import { AiError } from "@/lib/ai/errors";
import { assertLooksLikeSafeSelect } from "@/lib/ai/sql-guard";

/**
 * THE SANDBOX. Model-authored SQL runs here and nowhere else.
 *
 * Five independent controls, each written assuming the ones above it have already failed.
 * The ordering matters: the ones that hold are at the bottom of the stack, in the database.
 *
 *   1. ROLE     — getAiPrisma() is a separate PrismaClient bound to DATABASE_URL_AI, the
 *                 `operato_ai_ro` role, which holds SELECT and nothing else. This module
 *                 must NEVER import `prisma` from @/lib/db: that client owns the tables,
 *                 so it can write AND is exempt from RLS. One wrong import removes both
 *                 halves of the boundary while every comment still claims otherwise.
 *   2. READ-ONLY TRANSACTION + TIMEOUT + LIMIT — below.
 *   3. RLS      — `app.restaurant_id` is set with SET LOCAL semantics inside this
 *                 transaction, and the policies in the RLS migration decide which rows
 *                 exist. This, not a WHERE clause, is the tenant guarantee.
 *   4. STATIC PRE-FILTER — assertLooksLikeSafeSelect, re-run here rather than trusted from
 *                 the caller. Cheap, and NOT the boundary; see sql-guard.ts.
 *   5. STRUCTURED GENERATION — the SQL arrived from generateObject + Zod, never
 *                 JSON.parse of model text. See text-to-sql.ts.
 *
 * `$queryRawUnsafe` is used deliberately and is the only legitimate place for it in this
 * codebase: the statement is a dynamic string by definition, so there is no tagged template
 * that could parameterise it. Nothing user-supplied is concatenated in — the tenant id
 * goes in as a BIND PARAMETER via set_config, and the model supplies no parameters at all.
 */

/** Postgres gives up first. See TX_OPTIONS in the inventory/orders services for the same
 *  rule: if Prisma's own transaction timer fires first, the client abandons a statement
 *  the server is still happily running. 5s statement, 15s transaction. */
const STATEMENT_TIMEOUT = "5s";
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/** The hard row cap wrapped around whatever the model wrote. A thousand rows is far more
 *  than any answer needs and far less than an OOM or a runaway prompt. */
const MAX_ROWS = 1_000;

/**
 * Matches Prisma's generated ids (`@default(cuid())`) — a leading 'c', then lowercase
 * letters and digits. NOT a security boundary against a malicious caller: `restaurantId`
 * here always comes from `requireMember`, which already verified it against
 * `RestaurantMember` before this function is ever called, so it is trusted input, not
 * model output. It's asserted anyway so that if this function is ever called wrong — a
 * future refactor that threads something unverified through — the failure is a loud,
 * immediate rejection here, before the value reaches a `SET LOCAL` statement built by
 * string interpolation. See the comment at the SET LOCAL call below for why interpolation
 * replaced a bind parameter here.
 */
const RESTAURANT_ID_SHAPE = /^c[a-z0-9]{20,32}$/;

export type SqlRow = Record<string, unknown>;

export type ReadonlySqlResult = {
  rows: SqlRow[];
  /** True when the wrapper's LIMIT actually bit — the answer is a sample, and the prose
   *  step must say so rather than presenting a truncated total as a total. */
  truncated: boolean;
};

/**
 * Runs one model-authored SELECT for one tenant.
 *
 * @param restaurantId  From the URL param, verified by requireMember BEFORE this is
 *                      called. Never from the request body, and never from the model —
 *                      the model is not told it exists.
 * @param modelSql      Raw SQL as generated. Re-validated here; the normalised form is
 *                      what actually executes.
 */
export async function runReadonlySql(
  restaurantId: string,
  modelSql: string,
): Promise<ReadonlySqlResult> {
  // Defence 4, applied HERE rather than trusted from the caller. A future caller that
  // forgets the pre-filter must not be able to reach $queryRawUnsafe without it, and the
  // string that is checked has to be the string that runs.
  const sql = assertLooksLikeSafeSelect(modelSql);

  if (!RESTAURANT_ID_SHAPE.test(restaurantId)) {
    // Belt and braces: RLS already fails closed (an unset/malformed GUC makes
    // `"restaurantId" = NULL` null, never true, so zero rows). This just turns a caller
    // bug into a loud error here rather than a mysteriously empty answer, or — now that
    // this value is interpolated into a SET LOCAL statement rather than bound — a string
    // reaching SQL that was never checked.
    throw new AiError(500, "Internal error.", {
      cause: `runReadonlySql: restaurantId does not look like an id: ${restaurantId}`,
    });
  }

  const aiPrisma = getAiPrisma();

  try {
    return await aiPrisma.$transaction(async (tx) => {
      // ── Defence 2: the transaction the model's SQL is trapped inside ────────────────
      //
      // Both are SET LOCAL with HARD-CODED literals — no interpolation, nothing
      // caller-supplied — so `$executeRawUnsafe` here carries no injection surface.
      // SET LOCAL is scoped to this transaction, which matters on a pgbouncer connection
      // where the session is shared: it cannot leak into the next borrower.
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);

      // The one that makes a data-modifying CTE fail AT THE DATABASE, whatever the model
      // produced and whatever the keyword filter missed:
      //   WITH x AS (DELETE FROM "Order" RETURNING *) SELECT * FROM x
      // errors with "cannot execute DELETE in a read-only transaction".
      //
      // The role also carries default_transaction_read_only = on, so this is the second
      // of two. Redundant on a correctly provisioned database, and precisely what you want
      // when someone re-provisions the role by hand and forgets a flag.
      await tx.$executeRawUnsafe(`SET LOCAL transaction_read_only = on`);

      // ── Defence 3: RLS. This line is the tenant guarantee. ─────────────────────────
      //
      // `SET LOCAL ... = '<literal>'`, NOT a bind parameter and NOT set_config().
      //
      //   1. docs/plan-code-review.md Finding 3 sketches
      //        tx.$executeRawUnsafe(`SET LOCAL app.restaurant_id = $1`, restaurantId)
      //      and that DOES NOT RUN: SET is a utility statement, and Postgres does not
      //      accept bind parameters in one — syntax error at "$1".
      //   2. The obvious fix is set_config(name, value, is_local) — an ordinary function
      //      call, so $1 binds normally. THIS CODE USED TO DO EXACTLY THAT, and it was a
      //      live, verified cross-tenant read: set_config is callable from MODEL-authored
      //      SQL too, is not a data write, and the read-only role/transaction/LIMIT
      //      wrapper all permit it — a quoted or Unicode-escaped identifier
      //      (`"set_config"(...)`, `U&"\0073et_config"(...)`) evaded the keyword filter
      //      meant to block it, called set_config from inside the model's own query, and
      //      re-pointed RLS at another tenant mid-statement. Found and verified end-to-end
      //      by an sql-safety-reviewer audit.
      //
      // THE ACTUAL FIX for that is in src/lib/ai/sql-guard.ts: quoted identifiers are now
      // checked against an ALLOWLIST of real table/column names (not "set_config" spelled
      // any way), and `U&"` Unicode-escaped identifiers are rejected outright regardless
      // of what they decode to. Verified live, post-fix, against both payloads above.
      //
      // A database-level backstop was ATTEMPTED and DID NOT WORK, which is itself worth
      // recording so nobody "fixes" this again the same way: on this Neon project,
      // `pg_catalog.set_config` is owned by `cloud_admin` (Neon's internal superuser
      // role), not by `neondb_owner` (the app's role, and the one migrations run as).
      // Postgres silently no-ops a REVOKE issued by a role that neither owns the object
      // nor holds GRANT OPTION on it — it emits a WARNING, not an error, so
      // `..._revoke_set_config_from_public/migration.sql` applied "successfully" and
      // changed nothing; confirmed by reading `pg_proc.proacl` before and after. There is
      // no accessible role on this project that can narrow PUBLIC's execute grant on a
      // system catalog function, so `operato_ai_ro` can, and always will, be able to call
      // set_config — which is exactly why the code-level allowlist above is not a stopgap
      // for this vector, it is THE control.
      //
      // Switched to SET LOCAL with a literal anyway, on its own merits (one less function
      // call, and this code no longer needs any set_config-shaped capability at all).
      // `restaurantId` is never attacker- or model-controlled here (see
      // RESTAURANT_ID_SHAPE above) — asserted regardless, since it IS a literal now,
      // not a bind parameter.
      await tx.$executeRawUnsafe(`SET LOCAL app.restaurant_id = '${restaurantId}'`);

      // ── The model's query, sealed inside a subquery with a hard LIMIT ──────────────
      //
      // MAX_ROWS + 1 so a full page is distinguishable from a coincidence: exactly
      // MAX_ROWS rows back could mean either, and reporting a truncated list as complete
      // is how an answer becomes confidently wrong.
      //
      // sql-guard has already proved the string is paren-balanced, so `( sql )` really is
      // a subquery and cannot break out of the wrapper.
      const wrapped = `SELECT * FROM ( ${sql} ) AS _q LIMIT ${MAX_ROWS + 1}`;
      const rows = await tx.$queryRawUnsafe<SqlRow[]>(wrapped);

      // ── Post-execution: did the query move the tenant out from under RLS? ──────────
      //
      // operato_ai_ro CAN still execute set_config (see the comment above — a database-
      // level revoke was attempted and does not work on this Neon project), so this stays
      // load-bearing as a second, independent layer behind the sql-guard allowlist, not
      // decorative. Its honest limitation: it detects tampering that PERSISTS to end of
      // statement. A query that moved the GUC and restored it within the same target list
      // would slip past this specific check — which is exactly why it was never the fix on
      // its own, only ever a second check behind the guard.
      //
      // If this ever fires, the guard has a hole, and the request is refused rather than
      // trusted with a possibly-wrong tenant's rows.
      const [guc] = await tx.$queryRawUnsafe<{ tenant: string | null }[]>(
        `SELECT current_setting('app.restaurant_id', true) AS tenant`,
      );

      if (!guc || guc.tenant !== restaurantId) {
        throw new AiError(500, "The assistant could not complete that query safely.", {
          cause: `RLS tenant GUC moved during execution: expected ${restaurantId}, found ${guc?.tenant}`,
        });
      }

      return {
        rows: rows.slice(0, MAX_ROWS),
        truncated: rows.length > MAX_ROWS,
      };
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof AiError) throw error;

    // A Postgres error here is expected traffic, not an outage: the model wrote a column
    // that does not exist, joined wrong, hit the statement_timeout, or tried to read a
    // revoked column ("permission denied for column phone" is the PII grant doing its
    // job).
    //
    // The driver's message NEVER reaches the user. It names tables, columns and
    // constraints, which on the one endpoint that runs model-authored SQL is a free
    // schema-discovery oracle for anyone probing it. It goes to `cause` for the server log.
    //
    // NOT retried by feeding the error back to the model: that doubles the Gemini spend on
    // exactly the queries that already failed, against a free tier measured in a few
    // hundred requests a day for ALL tenants. A clear "try rephrasing" is the better trade.
    throw new AiError(422, "The assistant could not run that query. Try rephrasing.", {
      cause: error,
    });
  }
}
