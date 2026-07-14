// Build ERROR, not a runtime one, if this is ever pulled into a client bundle. The
// shell's client components import `Membership` from session.ts with `import type`, so
// the whole server graph is erased at compile — one dropped `type` keyword away from
// dragging Prisma into the browser. Make that a compile failure, not a mystery.
import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 has no Rust query engine: the connection is owned by a driver adapter
// constructed here, NOT by a `url` in schema.prisma. That is what lets the two
// clients below point at two different Postgres ROLES from one schema.

declare global {
  var __prisma: PrismaClient | undefined;
  var __prismaAi: PrismaClient | undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * The application client: full read/write, Neon's POOLED endpoint.
 * Owns every table, and therefore BYPASSES the Row-Level Security policies —
 * table owners are exempt unless FORCE ROW LEVEL SECURITY is set, and we
 * deliberately do not set it. Tenant isolation on this client is enforced in
 * code (`requireMember` + a restaurantId filter on every query), not by the DB.
 */
export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: required("DATABASE_URL") }),
  });

/**
 * The AI client: a SEPARATE PrismaClient bound to the `operato_ai_ro` role.
 *
 * This is the security boundary for the text-to-SQL path. The role holds only
 * SELECT, and carries `default_transaction_read_only = on` and a 5s
 * `statement_timeout` at the role level, so a model-generated write fails in the
 * DATABASE rather than relying on us to spot it in a string. Because this role
 * does not own the tables, RLS DOES apply to it — a query that forgets
 * `WHERE "restaurantId" = …` returns the active tenant's rows only.
 *
 * Never use this client for application queries, and never use `prisma` for the
 * AI path. Swapping them silently removes every one of those guarantees.
 *
 * LAZY on purpose. This module sits on nearly every request path (auth.ts imports
 * it), so constructing the AI client eagerly would make a missing DATABASE_URL_AI
 * take down sign-in and every page — not just the AI feature. It also avoids
 * opening a second connection pool in serverless instances that never run a query.
 */
export function getAiPrisma(): PrismaClient {
  const connectionString = required("DATABASE_URL_AI");

  // The whole AI boundary rests on this URL carrying operato_ai_ro's credentials.
  // Paste the owner URL here — an easy slip when setting up a Neon branch or preview
  // env — and prismaAi silently becomes a full read/write owner client that ALSO
  // bypasses RLS, with every docstring above still claiming otherwise. Fail loudly.
  if (connectionString === process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL_AI is identical to DATABASE_URL. The AI path would run as the " +
        "table owner: read/write, and exempt from RLS. Point it at operato_ai_ro.",
    );
  }

  globalThis.__prismaAi ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  return globalThis.__prismaAi;
}

/**
 * Proves — against the live connection, not the config — that the AI client is bound
 * to a role that cannot write and cannot escape RLS. Call from a health check / CI.
 *
 * The URL comparison in getAiPrisma() catches the obvious copy-paste; this catches the
 * subtler ways the boundary silently evaporates. Chief among them (Neon-specific): a
 * role created through the Neon CONSOLE rather than by `CREATE ROLE` in SQL is granted
 * `neon_superuser`, which carries BYPASSRLS — the policies would then bind nothing.
 */
export async function assertAiRoleIsSafe(): Promise<void> {
  const [row] = await getAiPrisma().$queryRaw<
    { current_user: string; read_only: string; superuser: boolean; bypassrls: boolean }[]
  >`
    SELECT current_user,
           current_setting('transaction_read_only') AS read_only,
           r.rolsuper      AS superuser,
           r.rolbypassrls  AS bypassrls
      FROM pg_roles r
     WHERE r.rolname = current_user
  `;

  if (!row) throw new Error("AI role check: could not read the current role.");
  if (row.current_user !== "operato_ai_ro")
    throw new Error(`AI role check: connected as "${row.current_user}", expected operato_ai_ro.`);
  if (row.read_only !== "on")
    throw new Error("AI role check: transaction_read_only is not on — the role can write.");
  if (row.superuser || row.bypassrls)
    throw new Error(
      "AI role check: the role has SUPERUSER or BYPASSRLS, so Row-Level Security binds " +
        "nothing and the AI can read every tenant. Recreate it with CREATE ROLE in SQL, " +
        "not via the Neon console (which grants neon_superuser).",
    );
}

// Next's dev server hot-reloads modules; without this, every reload leaks a new
// connection pool until Postgres refuses connections.
if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
