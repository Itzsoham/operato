import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";

import { PaletteProvider } from "@/components/palette-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/* Plus Jakarta Sans for interface — geometric enough to read as software, with
   humanist terminals that keep it from feeling like a bank. JetBrains Mono for
   currency, timers, quantities and the SQL that Ask Operato exposes.

   NOTE: since the four-palette system landed, these are no longer the app's only
   faces. Each palette declares its own --font-stack-* (Crema: Iowan display serif;
   Forno: Arial Black; Lievito: Futura at weight 200; Saffron: Palatino), and only
   the mono slot still reaches for --font-jetbrains. Jakarta remains loaded because
   it is the marketing site's face and the var() fallback everything else degrades
   to; the palettes deliberately prefer system faces so a palette switch costs zero
   network. */
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Operato",
  description: "The AI operating system for restaurants.",
};

/**
 * THE NO-FLASH SCRIPT.
 *
 * The palette lives on <html data-palette>. React cannot set it before the first
 * paint — it only runs after hydration — so without this every single load would
 * paint CREMA, then repaint in the user's actual palette a few hundred milliseconds
 * later. That is not a subtle flicker: Forno's rail is charred and Saffron's ground
 * is aubergine, so the correction is a full-page colour flash.
 *
 * This is the same trick next-themes uses for `.dark`, and it must obey the same
 * three rules:
 *   1. It is a BLOCKING classic script in <head> — no `async`, no `defer`, no
 *      `type=module`. The browser stops parsing, runs it, and the very first paint
 *      already has the attribute.
 *   2. The whole body is inside try/catch. `localStorage` THROWS, not returns null,
 *      in a Safari private window and wherever site data is blocked — an uncaught
 *      throw here would leave the document with no palette at all.
 *   3. It validates. A stale or hand-edited storage value must fall back to
 *      "crema", never be written through to the attribute.
 *
 * Kept as a string literal rather than importing PALETTES: this runs before any
 * bundle, so it cannot reference module scope. The four keys are duplicated here on
 * purpose and must stay in step with palette-provider.tsx.
 */
const PALETTE_SCRIPT = `(function(){try{var v=window.localStorage.getItem("operato-palette");var p=(v==="crema"||v==="forno"||v==="lievito"||v==="saffron")?v:"crema";document.documentElement.setAttribute("data-palette",p)}catch(e){document.documentElement.setAttribute("data-palette","crema")}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // Covers BOTH theming dimensions: next-themes writes `class="dark"` and the
      // script below writes `data-palette`, neither of which the server rendered.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PALETTE_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* ThemeProvider mounts the `.dark` class. Without it the entire dark palette —
            every `dark:` class in the app — is unreachable. See theme-provider.tsx.
            PaletteProvider owns the second dimension; it sits INSIDE so that anything
            reading both gets them from one subtree. */}
        <ThemeProvider>
          <PaletteProvider>
            {children}
            <Toaster />
          </PaletteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
