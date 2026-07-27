import { z } from "zod";

/**
 * The canonical question validator — one Zod schema per route input, shared with the
 * client form, per this codebase's own convention (see every other module's
 * src/lib/validations/*.ts). It lives here, not in src/lib/ai/text-to-sql.ts, precisely so
 * it CAN be shared: that file starts with `import "server-only"` and pulls in Prisma and
 * the AI SDK, so importing it from a client component would either fail the build or drag
 * server-only code into the browser bundle. The schema itself has no server dependency —
 * a server module importing a client-safe validations module is always fine; only the
 * reverse is blocked. text-to-sql.ts imports this one rather than declaring its own copy.
 */
export const aiQuestionSchema = z
  .string()
  .trim()
  .min(3, "Ask a slightly longer question.")
  .max(500, "That question is too long — try asking one thing at a time.");

export type AiQuestionInput = z.infer<typeof aiQuestionSchema>;
