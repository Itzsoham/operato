"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Mounts the `.dark` class that the whole stylesheet hangs off.
 *
 * globals.css defines `@custom-variant dark (&:is(.dark *))` and a full `.dark { … }`
 * block — but NOTHING was ever putting that class on the document. So every `dark:` class
 * in the app, and the entire dark palette, was unreachable dead code. shadcn's toaster
 * even imports `useTheme` from next-themes, which quietly returned the default forever.
 *
 * It went unnoticed because it fails silently: no error, no warning, just a light UI. Only
 * screenshotting the dashboard in dark mode showed it — the render was byte-identical.
 *
 * `attribute="class"` is what shadcn's variant expects.
 *
 * DEFAULT IS `light`, NOT `system`. Operato's default look is Crema in light — a warm
 * paper ground — and that is the palette the whole design system was authored against.
 * Following the OS instead meant a visitor whose laptop happens to be in dark mode saw
 * Crema-dark on first load and never saw the intended default at all.
 *
 * `enableSystem` STAYS ON, so "System" is still offered in the switcher alongside Light
 * and Dark — the default is an opinion about the first load, not a restriction. Once
 * someone picks, next-themes persists it and this value is never consulted again.
 *
 * Mode pairs with the palette dimension in palette-provider.tsx, whose default is
 * likewise `crema`; the two together are what a first-time visitor sees.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      // The theme is resolved before paint by next-themes' inline script; without this,
      // switching themes animates every colour transition on the page at once.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
