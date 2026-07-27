import type { StockLine } from "@/lib/inventory/service";

/**
 * The pure arithmetic/formatting rules behind the inventory alert — split out from
 * inventory-alerts.ts, which imports Gemini and the DB and carries `server-only`, purely
 * so THESE functions don't. They have real branching logic (urgency thresholds, sort
 * tie-breaks, singular/plural wording) and no DB or model dependency of their own, which
 * is exactly the shape `sql-guard.ts` and `schema-context.ts` are already kept pure for —
 * so tests/unit can hammer them directly instead of needing to mock Prisma and the AI SDK
 * just to prove a boundary condition. `StockLine` is imported as a TYPE ONLY (erased at
 * compile time), so this file never actually loads inventory/service.ts's `server-only`
 * module at runtime.
 */

/** Flag an item that is BELOW its threshold, or that will run out within a few days even
 *  though it is technically still above it. A threshold alone is blind to velocity: 20 kg
 *  of an ingredient you get through at 9 kg a day is more urgent than 3 kg of one nobody
 *  has touched since March. */
export const URGENT_DAYS = 3;

export function needsAttention(line: StockLine): boolean {
  if (line.needsReorder) return true;
  return line.daysLeft !== null && line.daysLeft <= URGENT_DAYS;
}

/** Most urgent first: fewest days of cover, then lowest absolute stock. An item with no
 *  measured usage (`daysLeft === null`) has no urgency to rank on and sorts last. */
export function byUrgency(a: StockLine, b: StockLine): number {
  const left = a.daysLeft ?? Number.POSITIVE_INFINITY;
  const right = b.daysLeft ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;
  return a.currentStock - b.currentStock;
}

/** The same information, assembled without a model. Also what ships if Finding 12's
 *  "cut the LLM prose" recommendation is ever taken. */
export function fallbackMessage(items: StockLine[]): string {
  const named = items
    .slice(0, 3)
    .map((item) =>
      item.daysLeft === null
        ? `${item.name} (${item.currentStock} ${item.unit} left)`
        : `${item.name} (about ${item.daysLeft} days left)`,
    )
    .join(", ");
  const more = items.length > 3 ? ` and ${items.length - 3} more` : "";
  const plural = items.length !== 1;
  return `${items.length} item${plural ? "s" : ""} ${plural ? "need" : "needs"} reordering: ${named}${more}.`;
}
