/**
 * Loads .env — and it must be IMPORTED, not called.
 *
 * ESM evaluates imported modules before the importing module's body runs. So a bare
 * `process.loadEnvFile(".env")` at the top of seed.ts executes AFTER
 * `import { auth } from "../src/lib/auth"` has already pulled in src/lib/db.ts, which
 * reads DATABASE_URL at module scope. The call looks like it configures the run; it
 * cannot. Importing this module first is what actually sequences it correctly.
 */
try {
  process.loadEnvFile(".env");
} catch (error) {
  // Missing .env is fine — CI and Vercel supply the vars ambiently. Anything else
  // (a malformed file, a permissions error) must surface, not hide behind a later
  // "Missing required environment variable".
  if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
}
