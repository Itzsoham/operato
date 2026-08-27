import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cn } from "../../src/lib/utils";

/**
 * The two ways a theme token can silently stop meaning what it says.
 *
 * Both bugs this file guards against shipped, and neither produced an error, a warning
 * or a failing type — the page just rendered wrong:
 *
 *   1. `--spacing-sm` OUT-RANKED `--container-sm`, so `max-w-sm` quietly became 12px
 *      and collapsed every Dialog, Sheet, Tooltip and the sign-in card to a sliver.
 *      Tailwind resolves the width utilities `--max-width-*` → `--spacing-*` →
 *      `--container-*`, so any --spacing-<t-shirt-name> eats that name's width.
 *
 *   2. tailwind-merge classified `text-body` as a text COLOUR (its guess for any
 *      `text-<unknown>`), so cn() treated it as conflicting with the colour a variant
 *      had already set and DELETED it — dark ink on a near-black button, and ~1,200
 *      elements app-wide rendering without their type step.
 *
 * Neither is caught by tsc, eslint or a snapshot of the CSS. They are caught here.
 */

const globalsCss = readFileSync(
  fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)),
  "utf8",
);

/** Every key declared in a `--<namespace>-*` slot of the @theme block. */
function themeKeys(namespace: string): string[] {
  const theme = globalsCss.slice(globalsCss.indexOf("@theme"), globalsCss.indexOf("\n/* ══"));
  const keys = [...theme.matchAll(new RegExp(`^\\s*--${namespace}-([a-z0-9-]+)\\s*:`, "gm"))]
    .map((m) => m[1])
    // `--text-body--line-height` and friends are sub-keys of a step, not steps.
    .filter((k) => !k.includes("--"));
  return [...new Set(keys)];
}

/** Tailwind's own container scale — the names a `--spacing-*` alias can shadow. */
const CONTAINER_SCALE = [
  "3xs", "2xs", "xs", "sm", "md", "lg", "xl",
  "2xl", "3xl", "4xl", "5xl", "6xl", "7xl",
];

describe("theme namespaces do not shadow the width scale", () => {
  it("restates every colliding t-shirt name in the higher-priority namespaces", () => {
    const collisions = themeKeys("spacing").filter((k) => CONTAINER_SCALE.includes(k));

    // Collisions are allowed — the palette rhythm is genuinely called xs/sm/lg — but
    // each one MUST be given back in the namespaces Tailwind consults first, or the
    // t-shirt width silently becomes a gap.
    for (const name of collisions) {
      for (const ns of ["max-width", "width", "min-width", "flex-basis"]) {
        expect(
          globalsCss,
          `--spacing-${name} shadows the container scale, so --${ns}-${name} must restate it ` +
            `(otherwise ${ns === "max-width" ? "max-w" : ns === "flex-basis" ? "basis" : ns.replace("-width", "-w")}-${name} collapses to the gap value)`,
        ).toMatch(new RegExp(`^\\s*--${ns}-${name}\\s*:`, "m"));
      }
    }
  });
});

describe("cn() knows this project's theme", () => {
  const SCALES: Array<[string, string, (name: string) => string]> = [
    ["text", "font size", (n) => `text-${n}`],
    ["spacing", "spacing", (n) => `p-${n}`],
    ["radius", "radius", (n) => `rounded-${n}`],
    ["shadow", "shadow", (n) => `shadow-${n}`],
  ];

  // A custom token tailwind-merge has not been taught is guessed to be a COLOUR, which
  // is how `text-body` came to delete `text-primary-foreground`. Probing each token
  // against a colour of the same family proves the colour survives.
  for (const [namespace, label, toClass] of SCALES) {
    it(`keeps colours intact next to every --${namespace}-* ${label}`, () => {
      const stockNames = new Set(["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "2xs", "3xs", "none", "full"]);
      const custom = themeKeys(namespace).filter((n) => !stockNames.has(n));
      expect(custom.length).toBeGreaterThan(0);

      for (const name of custom) {
        const cls = toClass(name);
        const merged = cn("text-primary-foreground bg-primary border-border", cls).split(" ");
        expect(merged, `"${cls}" is being treated as a colour and eats the ink beside it`)
          .toContain("text-primary-foreground");
        expect(merged).toContain(cls);
      }
    });
  }

  it("still lets a type step override a type step", () => {
    expect(cn("text-body", "text-small")).toBe("text-small");
    expect(cn("text-sm", "text-metric")).toBe("text-metric");
  });

  it("still lets a colour override a colour", () => {
    expect(cn("text-primary-foreground", "text-brand")).toBe("text-brand");
  });

  it("reproduces the button that shipped with an invisible label", () => {
    // buttonVariants({ variant: "default" }) + the marketing CTA's own className.
    const merged = cn(
      "bg-primary text-primary-foreground shadow hover:bg-primary/80",
      "h-tap text-body px-5 shadow-brand",
    );
    expect(merged).toContain("text-primary-foreground");
    expect(merged).toContain("text-body");
  });

  it("resolves the palette rhythm against the numeric scale instead of emitting both", () => {
    expect(cn("p-4", "p-card")).toBe("p-card");
    expect(cn("gap-2", "gap-sm")).toBe("gap-sm");
    expect(cn("h-9", "h-tap")).toBe("h-tap");
  });
});
