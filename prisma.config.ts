import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads `.env` — the CLI sees only the ambient environment
// unless we load it ourselves. Node's built-in loader avoids a `dotenv` dependency.
// In CI/Vercel the vars are already ambient, so a missing `.env` is not an error.
try {
  process.loadEnvFile(".env");
} catch (error) {
  // A MISSING .env is fine — in CI and on Vercel the vars are already ambient.
  // Anything else (a malformed .env, a permissions error) must NOT be swallowed:
  // it would surface later as a bogus "Missing required environment variable",
  // sending you hunting for an absent var when the real fault is the file itself.
  if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
}

export default defineConfig({
  schema: "prisma/schema.prisma",

  // Migrations and introspection need a real session, not a pgbouncer transaction,
  // so they run against Neon's DIRECT (unpooled) endpoint. The app's PrismaClient
  // still uses the pooled DATABASE_URL at runtime.
  datasource: {
    url: process.env["DIRECT_URL"],
  },

  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
