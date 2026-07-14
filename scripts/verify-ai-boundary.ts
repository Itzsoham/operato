/**
 * Proves the text-to-SQL security boundary against the LIVE database.
 *
 * This asserts the guarantees the AI path is built on, rather than assuming them:
 *
 *   1. The AI role cannot write.
 *   2. RLS actually BINDS the AI role (not SUPERUSER, not BYPASSRLS). A role created
 *      via the Neon console gets neon_superuser, which carries BYPASSRLS — the
 *      policies would then bind nothing and every tenant would be readable.
 *   3. No table is readable-but-unprotected: every table the AI can SELECT has RLS on.
 *      This is the check that catches a future migration adding a table and forgetting
 *      its policy — the single most likely way this boundary rots.
 *   4. RLS is fail-closed: with no tenant GUC set, the AI sees ZERO rows.
 *
 * Run: npm run verify:ai-boundary
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

process.loadEnvFile(".env");

function client(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const owner = client(process.env.DATABASE_URL!);
const ai = client(process.env.DATABASE_URL_AI!);

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // 1. The AI role cannot write.
  let wrote = false;
  try {
    await ai.$executeRawUnsafe(`CREATE TABLE ai_should_not_write (id int)`);
    wrote = true;
  } catch {
    /* expected */
  }
  check(!wrote, "AI role cannot write");

  // 2. RLS binds the AI role at all.
  const [role] = await ai.$queryRaw<{ me: string; superuser: boolean; bypassrls: boolean }[]>`
    SELECT current_user AS me, rolsuper AS superuser, rolbypassrls AS bypassrls
      FROM pg_roles WHERE rolname = current_user`;
  check(role.me === "operato_ai_ro", "AI connects as operato_ai_ro", `got "${role.me}"`);
  check(!role.superuser && !role.bypassrls, "AI role has neither SUPERUSER nor BYPASSRLS");

  // 3. Nothing is readable-but-unprotected. Asked as the OWNER, since the AI role
  //    cannot see the privileges of tables it has been denied.
  const exposed = await owner.$queryRaw<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND has_table_privilege('operato_ai_ro', c.oid, 'SELECT')
       AND NOT c.relrowsecurity`;
  check(
    exposed.length === 0,
    "no table is AI-readable without RLS",
    exposed.length ? exposed.map((t) => t.relname).join(", ") : "",
  );

  // 4. The auth tables specifically — password hashes and live session tokens.
  const authTables = await owner.$queryRaw<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname IN ('user', 'session', 'account', 'verification')
       AND has_table_privilege('operato_ai_ro', c.oid, 'SELECT')`;
  check(
    authTables.length === 0,
    "AI cannot read Better Auth tables (hashes/tokens)",
    authTables.length ? authTables.map((t) => t.relname).join(", ") : "",
  );

  // 5. Fail-closed: with no app.restaurant_id set, RLS yields zero rows.
  const [{ count }] = await ai.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM "Order"`;
  check(Number(count) === 0, "RLS is fail-closed with no tenant GUC set", `saw ${count} rows`);

  console.log(failures === 0 ? "\nAI boundary intact.\n" : `\n${failures} CHECK(S) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await owner.$disconnect();
    await ai.$disconnect();
  });
