import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge, taught this project's theme.
 *
 * WHY THIS IS NOT THE STOCK `twMerge`. tailwind-merge does not read globals.css —
 * it ships a hard-coded map of Tailwind's DEFAULT scales and guesses at anything
 * else. Its guess for an unrecognised `text-<name>` is TEXT COLOUR, because that
 * is what `text-brand` looks like. Every one of our type steps is an unrecognised
 * `text-<name>`, so:
 *
 *     cn("bg-primary text-primary-foreground", "text-body")  →  "bg-primary text-body"
 *
 * The colour was not overridden, it was DELETED — as a same-group conflict — and
 * the element fell back to ambient --foreground. That is dark ink on a near-black
 * --primary fill: the landing page's "Create your account" CTA (`<Button
 * className="... text-body ...">`) rendered its label invisible, and so did every
 * other call site that hands a type step to a component whose variant already
 * carries a colour. The `outline` CTA beside it was untouched, which is what made
 * it look like one broken button rather than a systemic merge bug.
 *
 * Registering the scales below moves them into the groups they belong to, so
 * `text-body` conflicts with `text-small` (both font-size) and no longer with
 * `text-primary-foreground` (colour). It also makes the non-colour scales
 * actually MERGE: `cn("p-4", "p-card")` used to emit BOTH and let stylesheet
 * order pick a winner, which is a coin-flip that changes when Tailwind reorders
 * its output.
 *
 * KEEP IN SYNC WITH THE `@theme` BLOCK IN src/app/globals.css. A token added
 * there and missed here is not a build error — it is a class that silently eats a
 * colour, which is the bug above all over again. Theme keys map to the Tailwind 4
 * namespaces: `text` ← --text-*, `spacing` ← --spacing-*, `radius` ← --radius-*,
 * `shadow` ← --shadow-*, `container` ← --container-*, `ease` ← --ease-*,
 * `tracking` ← --tracking-*, `font` ← --font-*.
 *
 * Colours are deliberately absent: --brand, --ready, --veg and friends are
 * already classified correctly, because "unrecognised means colour" is the right
 * guess for those.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // The --text-* ladder. THIS IS THE ONE THAT WAS CAUSING DELETIONS.
      text: [
        "display",
        "h1",
        "h2",
        "body",
        "small",
        "label",
        "chrome",
        "metric",
        "chip",
        "code",
      ],
      // --spacing-*: the tap floors, the shell rails, and the palette rhythm.
      spacing: [
        "tap",
        "tap-sm",
        "rail",
        "sidebar",
        "sidebar-mobile",
        "card",
        "card-sm",
        "page",
        "xs",
        "sm",
        "lg",
      ],
      // --radius-*: only the names Tailwind does not already know.
      radius: ["hair", "ctl", "ctl-sm", "pill"],
      // --shadow-*: likewise. Without these, `shadow-brand` reads as a shadow
      // COLOUR and fails to override the `shadow` the button variant sets.
      shadow: ["brand", "ready", "up", "rim"],
      container: ["measure"],
      ease: ["quint", "drawer"],
      tracking: ["label"],
      font: ["heading", "num"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
