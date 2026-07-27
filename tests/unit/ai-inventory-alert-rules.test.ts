import { describe, expect, it } from "vitest";

import {
  URGENT_DAYS,
  byUrgency,
  fallbackMessage,
  needsAttention,
} from "../../src/lib/ai/inventory-alert-rules";

/**
 * Pure arithmetic/formatting with real boundary conditions and no test touching it —
 * flagged by a code review. Split into inventory-alert-rules.ts (no `server-only`, no DB,
 * no model) specifically so this file can hammer it directly, the same reason
 * sql-guard.ts and schema-context.ts are kept pure.
 */

const line = (overrides: Partial<Parameters<typeof needsAttention>[0]> = {}) => ({
  id: "x",
  name: "Chicken",
  unit: "kg",
  currentStock: 10,
  lowStockThreshold: 5,
  costPerUnit: null,
  supplier: null,
  dailyUsage: 1,
  daysLeft: null as number | null,
  needsReorder: false,
  ...overrides,
});

describe("needsAttention", () => {
  it("flags an item already below its reorder threshold", () => {
    expect(needsAttention(line({ needsReorder: true, daysLeft: 30 }))).toBe(true);
  });

  it("flags an item above threshold but draining fast — the whole point of URGENT_DAYS", () => {
    expect(needsAttention(line({ needsReorder: false, daysLeft: 1 }))).toBe(true);
  });

  it("is inclusive at exactly the URGENT_DAYS boundary", () => {
    expect(needsAttention(line({ needsReorder: false, daysLeft: URGENT_DAYS }))).toBe(true);
  });

  it("does not flag just past the boundary", () => {
    expect(needsAttention(line({ needsReorder: false, daysLeft: URGENT_DAYS + 0.01 }))).toBe(
      false,
    );
  });

  it("does not flag a well-stocked, slow-moving item", () => {
    expect(needsAttention(line({ needsReorder: false, daysLeft: 30 }))).toBe(false);
  });

  it("does not flag an item with no measured usage at all", () => {
    expect(needsAttention(line({ needsReorder: false, daysLeft: null }))).toBe(false);
  });
});

describe("byUrgency", () => {
  it("sorts fewer days-left first", () => {
    const items = [line({ name: "B", daysLeft: 5 }), line({ name: "A", daysLeft: 1 })];
    expect(items.sort(byUrgency).map((i) => i.name)).toEqual(["A", "B"]);
  });

  it("sorts null daysLeft (no measured usage) last, even below a real number", () => {
    const items = [line({ name: "unmeasured", daysLeft: null }), line({ name: "urgent", daysLeft: 1 })];
    expect(items.sort(byUrgency).map((i) => i.name)).toEqual(["urgent", "unmeasured"]);
  });

  it("tie-breaks equal daysLeft on lower currentStock first", () => {
    const items = [
      line({ name: "more-stock", daysLeft: 2, currentStock: 20 }),
      line({ name: "less-stock", daysLeft: 2, currentStock: 5 }),
    ];
    expect(items.sort(byUrgency).map((i) => i.name)).toEqual(["less-stock", "more-stock"]);
  });
});

describe("fallbackMessage", () => {
  it("uses singular wording for exactly one item", () => {
    expect(fallbackMessage([line({ name: "Chicken", daysLeft: 2 })])).toBe(
      "1 item needs reordering: Chicken (about 2 days left).",
    );
  });

  it("uses plural wording and lists up to 3 items with no '+N more' suffix at exactly 3", () => {
    const items = [
      line({ name: "A", daysLeft: 1 }),
      line({ name: "B", daysLeft: 2 }),
      line({ name: "C", daysLeft: 3 }),
    ];
    const message = fallbackMessage(items);
    expect(message.startsWith("3 items need reordering: A")).toBe(true);
    expect(message).not.toContain("more");
  });

  it("adds an 'and N more' suffix past 3 items, counting only the overflow", () => {
    const items = [
      line({ name: "A", daysLeft: 1 }),
      line({ name: "B", daysLeft: 2 }),
      line({ name: "C", daysLeft: 3 }),
      line({ name: "D", daysLeft: 4 }),
      line({ name: "E", daysLeft: 5 }),
    ];
    expect(fallbackMessage(items)).toContain("and 2 more");
  });

  it("phrases an item with no measured usage by absolute stock, not a fabricated day count", () => {
    expect(fallbackMessage([line({ name: "Rare Spice", daysLeft: null, currentStock: 3 })])).toBe(
      "1 item needs reordering: Rare Spice (3 kg left).",
    );
  });
});
