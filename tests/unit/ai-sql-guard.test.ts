import { describe, expect, it } from "vitest";

import { AI_SQL_EXAMPLES, TZ_TOKEN } from "@/lib/ai/examples";
import { UnsafeSqlError } from "@/lib/ai/errors";
import { assertLooksLikeSafeSelect, looksLikeSafeSelect } from "@/lib/ai/sql-guard";

/**
 * Adversarial fixtures for the text-to-SQL pre-filter.
 *
 * READ THIS FIRST, because it changes how the failures below should be interpreted.
 * A green suite here does NOT mean the AI path is safe. This filter is not the security
 * boundary — the read-only `operato_ai_ro` role, the read-only transaction with a
 * statement_timeout, and Row-Level Security are. Every payload in this file would ALSO be
 * stopped by the database with this whole file deleted.
 *
 * What these tests are for: pinning the filter's behaviour so a future "let's relax this
 * regex, it's rejecting a menu item called Grant" change has to argue with a red test
 * first, and documenting the attack shapes so the next reader knows what was considered.
 */

/** Assert rejection AND that it failed for the expected structural reason. */
function expectRejected(sql: string) {
  expect(looksLikeSafeSelect(sql), `should have been rejected: ${sql}`).toBe(false);
  expect(() => assertLooksLikeSafeSelect(sql)).toThrow(UnsafeSqlError);
}

describe("stacked statements", () => {
  it("rejects a second statement hidden behind a valid SELECT", () => {
    // The exact payload docs/plan-code-review.md Finding 3 uses to kill
    // startsWith("SELECT"): it does start with SELECT.
    expectRejected(`SELECT 1; DROP TABLE "Order"`);
    expectRejected(`SELECT 1; DROP TABLE "Order";`);
    expectRejected(`SELECT 1;SELECT 2`);
  });

  it("still rejects when the payload is the thing being trimmed", () => {
    // Only ONE trailing semicolon is stripped, and only from the very end, so the inner
    // separator survives to be caught.
    expectRejected(`SELECT 1; DELETE FROM "Customer";`);
  });
});

describe("data-modifying CTEs — the attack a SELECT prefix check cannot see", () => {
  it("rejects DELETE ... RETURNING inside a WITH", () => {
    expectRejected(`WITH x AS (DELETE FROM "Order" RETURNING *) SELECT * FROM x`);
  });

  it("rejects UPDATE and INSERT CTEs", () => {
    expectRejected(`WITH x AS (UPDATE "Customer" SET "totalSpend" = 0 RETURNING *) SELECT * FROM x`);
    expectRejected(`WITH x AS (INSERT INTO "Order" VALUES (1) RETURNING *) SELECT * FROM x`);
  });

  it("rejects a read-only-looking CTE that still writes further in", () => {
    expectRejected(
      `WITH a AS (SELECT 1), b AS (DELETE FROM "Shift" RETURNING *) SELECT * FROM a, b`,
    );
  });
});

describe("comments", () => {
  it("rejects line and block comments anywhere", () => {
    expectRejected(`SELECT 1 -- comment`);
    expectRejected(`-- comment\nSELECT 1`);
    expectRejected(`SELECT /* hidden */ 1`);
    expectRejected(`SELECT 1 */`);
  });

  it("rejects a keyword smuggled through comment splitting", () => {
    expectRejected(`SELECT * FROM "Order" WHERE 1=1 /**/ UNION /**/ SELECT 1`);
  });
});

describe("write keywords, in any casing", () => {
  it.each([
    `INSERT INTO "Order" VALUES (1)`,
    `UPDATE "Customer" SET "totalSpend" = 999`,
    `DELETE FROM "Order"`,
    `DROP TABLE "Order"`,
    `ALTER TABLE "Order" DISABLE ROW LEVEL SECURITY`,
    `CREATE TABLE evil (id text)`,
    `TRUNCATE "Order"`,
    `GRANT SELECT ON "Customer" TO operato_ai_ro`,
    `COPY "Order" TO '/tmp/out.csv'`,
  ])("rejects %s", (sql) => expectRejected(sql));

  it("is case-insensitive", () => {
    expectRejected(`sElEcT 1; dRoP TABLE "Order"`);
    expectRejected(`WITH x AS (dElEtE FROM "Order" returning *) SELECT * FROM x`);
  });

  it("rejects a disable-RLS attempt even though it starts with SELECT", () => {
    expectRejected(`SELECT 1; ALTER TABLE "Order" DISABLE ROW LEVEL SECURITY`);
  });
});

describe("system catalogs and functions", () => {
  it("rejects the pg_* family wholesale, not just pg_sleep/pg_read", () => {
    expectRejected(`SELECT pg_sleep(30)`);
    expectRejected(`SELECT pg_read_file('/etc/passwd')`);
    expectRejected(`SELECT * FROM pg_catalog.pg_tables`);
    expectRejected(`SELECT relname FROM pg_class`);
  });

  it("rejects pg_stat_activity — a cross-tenant read RLS does NOT cover", () => {
    // System views have no restaurantId and no policy, so RLS is silent here. This view
    // exposes the QUERY TEXT of every other session, including the app's writes for other
    // tenants. The spec's `pg_sleep|pg_read` enumeration would have let it through.
    expectRejected(`SELECT query FROM pg_stat_activity`);
  });

  it("rejects pg_stat_activity spelled with a Unicode-escaped identifier", () => {
    expectRejected(`SELECT query FROM U&"\\0070g_stat_activity"`);
  });

  it("rejects information_schema", () => {
    expectRejected(`SELECT table_name FROM information_schema.tables`);
  });
});

describe("tenant pivot via the RLS session variable", () => {
  /**
   * The vector the spec's keyword list misses entirely. set_config() is an ordinary
   * function, not a write, so the read-only role, the read-only transaction and the LIMIT
   * wrapper ALL permit it — and it re-points every RLS policy at another tenant.
   */
  it("rejects set_config in any position", () => {
    expectRejected(
      `SELECT * FROM "Order" WHERE set_config('app.restaurant_id','victim',true) <> 'x'`,
    );
    expectRejected(`SELECT set_config('app.restaurant_id', 'victim', true)`);
    expectRejected(`SELECT set_config ( 'app.restaurant_id', 'victim', true )`);
  });

  it("rejects reading the tenant GUC too", () => {
    expectRejected(`SELECT current_setting('app.restaurant_id', true)`);
  });

  /**
   * VERIFIED, LIVE, CROSS-TENANT breach against an earlier version of this guard — caught
   * by an sql-safety-reviewer audit, not by this test file, which is exactly backwards and
   * the reason these are pinned here now. `\s*\(` after the keyword required whitespace
   * immediately before the open-paren; a double-quoted identifier has a `"` there instead,
   * so `"set_config"(...)` walked straight through while the READ-ONLY role, READ-ONLY
   * transaction and LIMIT wrapper all permitted the call — RLS re-pointed at another
   * tenant mid-query, through the unmodified production `runReadonlySql()`, with a clean
   * result and no error.
   */
  it("rejects set_config double-quoted as an identifier", () => {
    expectRejected(
      `WITH p AS (SELECT "set_config"('app.restaurant_id','victim',true) AS v) ` +
        `SELECT o."restaurantId" FROM "Order" o, p`,
    );
    expectRejected(`SELECT "current_setting"('app.restaurant_id', true)`);
  });

  /**
   * Postgres's UNICODE-ESCAPED identifier syntax spells a name without its literal text
   * ever appearing in the string — no keyword rule, quoted or not, can find "set_config"
   * in `U&"\0073et_config"`. This is the other half of the same verified breach.
   */
  it("rejects set_config spelled with a Unicode-escaped identifier", () => {
    expectRejected(
      `WITH p AS (SELECT U&"\\0073et_config"('app.restaurant_id','victim',true) AS v) ` +
        `SELECT o."restaurantId" FROM "Order" o, p`,
    );
  });
});

describe("dynamic SQL smuggled inside a plain SELECT", () => {
  it("rejects query_to_xml and friends", () => {
    // The payload is a string literal, so no keyword rule can see into it.
    expectRejected(`SELECT query_to_xml('SELECT * FROM pg_stat_activity', true, false, '')`);
    expectRejected(`SELECT * FROM dblink('dbname=x', 'SELECT 1') AS t(a int)`);
  });

  it("rejects dollar quoting", () => {
    expectRejected(`SELECT $$anything$$`);
    expectRejected(`SELECT $tag$anything$tag$`);
  });

  it("rejects query_to_xml spelled with a Unicode-escaped identifier", () => {
    expectRejected(`SELECT U&"\\0071uery_to_xml"('SELECT 1', true, false, '')`);
  });
});

describe("the quoted-identifier allowlist", () => {
  /**
   * The structural fix, not just a patch for the two payloads above: EVERY double-quoted
   * identifier must be a real table or column name from schema-context.ts, whatever it is.
   * This closes the whole "quote a forbidden name" family in one rule instead of one
   * blacklist entry per function anyone thinks to enumerate.
   */
  it("rejects a quoted identifier that names no real table or column", () => {
    expectRejected(`SELECT "totally_made_up_column" FROM "Order"`);
    expectRejected(`SELECT * FROM "NotARealTable"`);
    expectRejected(`SELECT "salary" FROM "Staff"`); // real column, but not AI-granted/listed
  });

  it("still accepts every real table and column name quoted", () => {
    expect(
      looksLikeSafeSelect(
        `SELECT o."totalAmount", o."paidAt" FROM "Order" o WHERE o.status = 'PAID'`,
      ),
    ).toBe(true);
  });

  it("does not flag an unquoted alias — only double-quoted identifiers are checked", () => {
    expect(
      looksLikeSafeSelect(`SELECT SUM(o."totalAmount") AS revenue_total FROM "Order" o`),
    ).toBe(true);
  });

  it('does not mistake a `"` inside a single-quoted string literal for an identifier', () => {
    expect(
      looksLikeSafeSelect(`SELECT id FROM "MenuItem" WHERE name = 'The "Special" Roll'`),
    ).toBe(true);
  });
});

describe("backslash", () => {
  it("rejects any backslash — the only way to spell a Unicode-escaped identifier", () => {
    expectRejected(`SELECT * FROM "Order" WHERE notes LIKE 'a\\%'`);
  });
});

describe("breaking out of the LIMIT wrapper", () => {
  /**
   * The executor builds `SELECT * FROM ( <sql> ) AS _q LIMIT 1001`. If <sql> is not
   * paren-balanced, that concatenation produces valid SQL with a shape nobody intended and
   * the "subquery" is no longer a subquery.
   */
  it("rejects SQL that closes a parenthesis it never opened", () => {
    expectRejected(`SELECT 1) AS x, (SELECT 2`);
    expectRejected(`SELECT * FROM "Order") AS q, (SELECT 1`);
  });

  it("rejects unbalanced parentheses in either direction", () => {
    expectRejected(`SELECT (1`);
    expectRejected(`SELECT count(*) FROM ("Order"`);
  });

  it("rejects an unterminated string literal", () => {
    expectRejected(`SELECT * FROM "MenuItem" WHERE name = 'unclosed`);
  });
});

describe("statement shape", () => {
  it("requires SELECT or WITH at the start", () => {
    expectRejected(`TABLE "Order"`);
    expectRejected(`(SELECT 1)`);
    expectRejected(`EXPLAIN SELECT 1`);
    expectRejected(`SET LOCAL app.restaurant_id = 'victim'`);
  });

  it("rejects empty and oversized input", () => {
    expectRejected("");
    expectRejected("   \n  ");
    expectRejected(`SELECT '${"a".repeat(5000)}'`);
  });
});

describe("what must still be ACCEPTED — a filter that rejects everything is useless", () => {
  it("accepts a plain tenant-scoped aggregate", () => {
    expect(
      looksLikeSafeSelect(`SELECT SUM("totalAmount") FROM "Order" WHERE status = 'PAID'`),
    ).toBe(true);
  });

  it("accepts a read-only CTE", () => {
    expect(
      looksLikeSafeSelect(`WITH b AS (SELECT NOW() AS t) SELECT * FROM "Order", b`),
    ).toBe(true);
  });

  it("strips ONE trailing semicolon rather than failing the query", () => {
    // Models emit these constantly. Rejecting them outright would fail a large share of
    // otherwise perfect queries, and a semicolon with nothing after it cannot start a
    // second statement.
    expect(assertLooksLikeSafeSelect(`SELECT 1;`)).toBe("SELECT 1");
    expect(assertLooksLikeSafeSelect(`SELECT 1 ;  \n `)).toBe("SELECT 1");
    expect(assertLooksLikeSafeSelect(`  SELECT 1  `)).toBe("SELECT 1");
  });

  it("does not trip on `createdAt`, where `create` is a substring", () => {
    // \b saves this: the `d` after `create` is a word character, so there is no boundary.
    // Without word boundaries the filter would reject nearly every date-filtered query.
    expect(
      looksLikeSafeSelect(`SELECT "createdAt" FROM "Order" ORDER BY "createdAt" DESC`),
    ).toBe(true);
  });

  it("counts parens inside string literals as text, not structure", () => {
    expect(
      looksLikeSafeSelect(`SELECT id FROM "MenuItem" WHERE name = 'Fish (Fried)'`),
    ).toBe(true);
  });

  it("handles a doubled quote inside a literal", () => {
    expect(
      looksLikeSafeSelect(`SELECT id FROM "MenuItem" WHERE name = 'It''s Chicken'`),
    ).toBe(true);
  });
});

describe("the curated examples must survive their own filter", () => {
  /**
   * The highest-value test in this file. The worked examples in examples.ts are what the
   * model imitates most faithfully — so if one of them would be REJECTED by the guard, the
   * prompt is actively teaching the model to write SQL the sandbox refuses, and the
   * feature fails on its own demo questions with no obvious cause.
   */
  it.each(AI_SQL_EXAMPLES.map((ex) => [ex.question, ex.sql] as const))(
    "%s",
    (_question, sql) => {
      const resolved = sql.split(TZ_TOKEN).join("Asia/Kolkata");
      expect(looksLikeSafeSelect(resolved), `rejected:\n${resolved}`).toBe(true);
    },
  );

  it("no example filters on restaurantId — RLS does the scoping", () => {
    // If an example did, the model would copy it, and a hallucinated id in that WHERE
    // clause would return zero rows and read as "you had no sales".
    for (const example of AI_SQL_EXAMPLES) {
      expect(example.sql, example.question).not.toMatch(/restaurantId/);
    }
  });

  it("no example uses SELECT * — it is a hard permission error on Customer", () => {
    for (const example of AI_SQL_EXAMPLES) {
      expect(example.sql, example.question).not.toMatch(/SELECT\s+\*/i);
    }
  });

  it("every timezone reference goes through the token, never a hard-coded zone", () => {
    // A hard-coded 'Asia/Kolkata' in an example would give a restaurant in Dubai Indian
    // day boundaries in every answer, while the DATES section politely said otherwise.
    for (const example of AI_SQL_EXAMPLES) {
      const zones = example.sql.match(/AT TIME ZONE '([^']+)'/g) ?? [];
      for (const zone of zones) {
        expect(zone === `AT TIME ZONE 'UTC'` || zone.includes(TZ_TOKEN), zone).toBe(true);
      }
    }
  });
});
