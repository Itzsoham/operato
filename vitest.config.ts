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
      /**
       * `import "server-only"` THROWS under plain Node — the package resolves to its
       * `empty.js` only under the `react-server` export condition, and to a module whose
       * body is a bare `throw` otherwise. That is the point of the marker, but it also
       * means a module can be perfectly pure (no DB, no network, no React) and still be
       * untestable purely because it carries the marker. Resolving it to that same
       * `empty.js` here restores the intent: the marker guards the CLIENT bundle, and a
       * Node test runner is not a client bundle.
       */
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
