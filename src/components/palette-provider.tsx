"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

/**
 * PALETTE — the app's SECOND, independent theming dimension.
 *
 * MODE (light/dark) stays on next-themes' `.dark` class; this provider owns nothing
 * about it. PALETTE is a `data-palette` attribute on <html>, and globals.css resolves
 * the two together:
 *
 *   :root, [data-palette="crema"]      crema  light   (0,1,0)
 *   [data-palette="forno"]             forno  light   (0,1,0), later source wins
 *   .dark, .dark[data-palette="crema"] crema  dark     (0,1,0)/(0,2,0)
 *   .dark[data-palette="forno"]        forno  dark     (0,2,0), beats plain .dark
 *
 * Eight combinations, one 131-token contract. Every palette re-themes colour AND
 * FORM — radii, shadows, type faces and spacing are tokens too — so switching is a
 * change of shape, not a hue swap.
 *
 * THE ATTRIBUTE IS NOT WRITTEN HERE FIRST. It is stamped synchronously by the
 * blocking script in app/layout.tsx, before first paint. If React were the only
 * writer, every load would paint Crema and then correct itself on hydration — a
 * full-page colour flash. So <html data-palette> is the STORE and this provider is a
 * subscriber to it, not its owner. That is also why the state is read through
 * useSyncExternalStore rather than useState + useEffect: the DOM attribute is a real
 * external system with a real server snapshot (the default), which is exactly the
 * shape useSyncExternalStore exists for — and it keeps hydration honest without a
 * setState-in-effect cascade.
 */

export const PALETTES = [
  {
    key: "crema",
    name: "Crema",
    blurb: "Speciality coffee counter — espresso on chalk, caramel, elevated cards.",
  },
  {
    key: "forno",
    name: "Forno",
    blurb: "Wood-fired pizzeria — charred rail, hard shadows, shouted type.",
  },
  {
    key: "lievito",
    name: "Lievito",
    blurb: "Minimal Neapolitan — square corners, no shadows, wide-set caps.",
  },
  {
    key: "saffron",
    name: "Saffron House",
    blurb: "Candlelit dining room — brass leaf, sharp rules, display serif.",
  },
] as const;

export type Palette = (typeof PALETTES)[number]["key"];

export const DEFAULT_PALETTE: Palette = "crema";
export const PALETTE_STORAGE_KEY = "operato-palette";
export const PALETTE_ATTRIBUTE = "data-palette";

const PALETTE_KEYS = PALETTES.map((p) => p.key) as readonly string[];

export function isPalette(value: unknown): value is Palette {
  return typeof value === "string" && PALETTE_KEYS.includes(value);
}

/* ── The store: <html data-palette> ─────────────────────────────────────────── */

/** Fires whenever anything writes the attribute — this tab's setPalette, or a
 *  devtools edit. One observer per subscriber; React keeps that to one in practice. */
function subscribeToAttribute(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [PALETTE_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

/** Always validates. A stale or hand-edited attribute resolves to the default rather
 *  than being handed to a component that will index a record with it. */
function readAttribute(): Palette {
  const value = document.documentElement.getAttribute(PALETTE_ATTRIBUTE);
  return isPalette(value) ? value : DEFAULT_PALETTE;
}

/** The server has no <html> to read and no storage to consult, so it renders the
 *  default — which is exactly what the pre-paint script falls back to as well. */
function serverSnapshot(): Palette {
  return DEFAULT_PALETTE;
}

/** `mounted` as an external store too, for the same lint-clean reason. Consumers use
 *  it to hold a stable placeholder until next-themes' resolved value exists — that
 *  value is client-only, so rendering it on the first pass would mismatch. */
const neverChanges = () => () => {};
const alwaysTrue = () => true;
const alwaysFalse = () => false;

type PaletteContextValue = {
  palette: Palette;
  setPalette: (palette: Palette) => void;
  mounted: boolean;
};

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const palette = useSyncExternalStore(subscribeToAttribute, readAttribute, serverSnapshot);
  const mounted = useSyncExternalStore(neverChanges, alwaysTrue, alwaysFalse);

  const setPalette = useCallback((next: Palette) => {
    // Write the STORE, not a copy of it. The MutationObserver above turns this into
    // the re-render, so there is exactly one source of truth and no way for React
    // state and the document to disagree.
    document.documentElement.setAttribute(PALETTE_ATTRIBUTE, next);
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
    } catch {
      // Private mode, blocked cookies, quota. The palette still applies for this
      // session; it simply will not be remembered. Never let this throw into render.
    }
  }, []);

  const value = useMemo(
    () => ({ palette, setPalette, mounted }),
    [palette, setPalette, mounted],
  );

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used inside <PaletteProvider>");
  return ctx;
}
