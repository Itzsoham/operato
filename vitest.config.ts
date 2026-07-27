import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Vitest does not read `paths` out of tsconfig.json, so without this alias every
 * `@/lib/...` import in a unit test fails to resolve. The existing validations test only
 * passed because it reached across with relative paths.
 *
 * `tests/unit` is pure logic by design — the SQL pre-filter, the schema allowlist, the Zod
 * schemas. Nothing here opens a database connection or calls Gemini, which is what makes
 * `src/lib/ai/` worth keeping decoupled from React and from route handlers.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
