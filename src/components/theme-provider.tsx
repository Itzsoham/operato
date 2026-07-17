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
 * `attribute="class"` is what shadcn's variant expects; `defaultTheme="system"` follows the
 * OS until someone chooses otherwise.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // The theme is resolved before paint by next-themes' inline script; without this,
      // switching themes animates every colour transition on the page at once.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
