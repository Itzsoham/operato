"use client";

import { Monitor, Moon, Palette as PaletteIcon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { PALETTES, isPalette, usePalette, type Palette } from "@/components/palette-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The control for BOTH theming dimensions, in one menu, in the top bar.
 *
 * MODE and PALETTE are independent (see palette-provider.tsx), but they are one
 * decision to a user — "what does this look like" — so they share a surface.
 * Putting them in two places is how the two states drift apart; the account menu's
 * old Theme submenu was removed when this landed, and mode is now controlled here
 * and nowhere else.
 *
 * ACCESSIBILITY, deliberately:
 *  · The trigger is a real <button> with an aria-label, so an icon-only control
 *    still has a name. Focus comes from button.tsx's focus-visible ring plus the
 *    :focus-visible floor in globals.css — the two-ring construct, so the ring
 *    survives on all eight palette/mode combinations.
 *  · Both lists are RADIO groups, not a pile of items: a screen reader announces
 *    "4 of 4, selected", which is the actual shape of the choice. Base UI gives
 *    roving arrow-key focus, Home/End, type-ahead and Escape for free.
 *  · The swatch strip is aria-hidden. It is a preview, not information — the name
 *    and the blurb carry the meaning, so nothing is lost without colour.
 */

/**
 * Swatches, READ FROM THE LIVE CASCADE — never from copied hexes.
 *
 * The first version of this file inlined 32 literal hexes lifted out of globals.css.
 * They were correct on the day they were written and had no way to stay correct: a
 * palette is re-tuned in the stylesheet and the preview quietly starts lying, which
 * is worse than no preview at all. There is no lint, no type and no test that can
 * catch that drift.
 *
 * So each row renders its own two-dimensional theming context instead. The eight
 * blocks in globals.css are selected by `[data-palette=…]` and `.dark[data-palette=…]`
 * — plain ATTRIBUTE and CLASS selectors, not `:root`-anchored — so stamping both onto
 * a <span> re-resolves every token inside that span to the palette being previewed,
 * in the mode currently on screen. `.dark` must go on the SAME element as the
 * attribute, because `.dark[data-palette=forno]` is a compound selector; nesting the
 * two on separate elements silently falls back to Crema's dark values.
 *
 * That makes `borderRadius: var(--r-sm)` free, and it is the point: a palette switch
 * changes radii, shadows, type and spacing, not just hue, so the row has to preview
 * FORM too. Lievito's 2px squares and Crema's 8px rounds read as different products
 * at 14px.
 */
const SWATCH_TOKENS: Record<Palette, readonly string[]> = {
  // ground · sidebar (pale wood) · brand caramel · the crema-gold alarm
  crema: ["--background", "--sidebar", "--brand", "--ready"],
  // ground · THE CHARRED RAIL (identical in both modes) · sauce · ember
  forno: ["--background", "--sidebar", "--brand", "--ready"],
  // ground · the paper sheet (LIGHTER than the ground) · terracotta · ink slab
  lievito: ["--background", "--sidebar", "--brand", "--ready"],
  // ground · sidebar · brass · SAFFRON, not --ready: THE ONE BRASS RULE makes
  // --ready === --brand in this palette, and two identical swatches read as a bug
  // rather than as the deliberate collision it is.
  saffron: ["--background", "--sidebar", "--brand", "--warning"],
};

const MODES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * Must match `defaultTheme` in theme-provider.tsx. next-themes returns `undefined` for
 * `theme` until it has read storage, and whatever we show during that window has to be
 * the value that is actually being applied — otherwise the menu opens with the wrong
 * radio checked and the user "changes" a setting that was never set.
 *
 * Operato defaults to LIGHT (Crema light is the authored default look), not `system`.
 * "System" remains selectable below; it is simply no longer the starting point.
 */
const DEFAULT_MODE = "light";

function SwatchRow({ palette, isDark }: { palette: Palette; isDark: boolean }) {
  return (
    <span
      // Both dimensions, on ONE element — see the note above.
      data-palette={palette}
      className={`flex shrink-0 items-center gap-1${isDark ? " dark" : ""}`}
      aria-hidden="true"
    >
      {SWATCH_TOKENS[palette].map((token) => (
        <span
          key={token}
          className="border-foreground/15 size-3.5 border"
          style={{ background: `var(${token})`, borderRadius: "var(--r-sm)" }}
        />
      ))}
    </span>
  );
}

export function PaletteSwitcher() {
  const { palette, setPalette, mounted } = usePalette();
  // `theme` (not `resolvedTheme`) for the SELECTED value — "System" must show as
  // chosen when that is what the user picked. `resolvedTheme` is what the swatches
  // must preview, because that is what is actually on screen.
  const { theme, setTheme, resolvedTheme } = useTheme();

  // HYDRATION GUARD. Neither next-themes' resolved value nor <html data-palette>
  // exists on the server, so a first client render that used them would not match
  // the server's HTML. Render a same-size, same-shape placeholder until the effects
  // in both providers have run; the button reserves its own space so the header does
  // not reflow when the real control appears.
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Appearance"
        disabled
        aria-hidden="true"
        tabIndex={-1}
      >
        <PaletteIcon />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";
  const current = PALETTES.find((p) => p.key === palette) ?? PALETTES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            // The name says what the control DOES and what it is currently set to,
            // so an icon-only trigger is still self-describing when tabbed to.
            aria-label={`Appearance: ${current.name}, ${theme ?? DEFAULT_MODE} mode`}
            data-testid="palette-switcher"
          >
            <PaletteIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        {/* Base UI throws "MenuGroupContext is missing" if a Label sits outside a
            Group — at RUNTIME, on open, which a build will never catch. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Palette</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={palette}
            onValueChange={(value) => {
              // The menu hands back a string; only write a key we recognise, so a
              // future rename cannot stamp a dead value onto <html>.
              if (isPalette(value)) setPalette(value);
            }}
          >
            {PALETTES.map((p) => (
              <DropdownMenuRadioItem key={p.key} value={p.key} className="items-start py-1.5">
                <SwatchRow palette={p.key} isDark={isDark} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground text-small leading-snug text-pretty">
                    {p.blurb}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Mode</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? DEFAULT_MODE} onValueChange={setTheme}>
            {MODES.map(({ value, label, Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
