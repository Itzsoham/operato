import Link from "next/link";

import { PaletteSwitcher } from "@/components/shell/palette-switcher";
import { Button } from "@/components/ui/button";

/**
 * Public chrome for the marketing site: a sticky nav + footer, no sidebar, no auth
 * guard. Every page in this route group is reachable by a signed-out visitor, which is
 * the point — this is the page a restaurant owner hits *before* they have an account.
 *
 * `.bg-app` paints each palette's own ground gradient (fixed attachment) rather than a
 * flat --background, so the marketing site sits on the same paper as the app. The
 * appearance control in the header is the SAME component the app's top bar uses — a
 * palette chosen here is the palette you sign in to.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-app flex min-h-svh flex-col">
      <header className="bg-background/80 border-border sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="mx-auto flex max-w-measure items-center justify-between gap-(--gap-sm) px-(--pad-page) py-(--gap-sm)">
          <Link
            href="/"
            className="flex min-h-tap-sm items-center gap-(--gap-xs) [font:var(--t-h2)]"
          >
            <span
              aria-hidden
              className="bg-[image:var(--grad-brand)] text-brand-foreground text-chip grid size-6 place-items-center rounded-md"
            >
              OP
            </span>
            Operato
          </Link>

          <nav
            aria-label="Marketing"
            className="text-small text-muted-foreground hidden items-center gap-(--gap-lg) sm:flex"
          >
            <Link
              href="/"
              className="hover:text-foreground duration-(--dur) ease-quint transition-colors"
            >
              Home
            </Link>
            <Link
              href="/pricing"
              className="hover:text-foreground duration-(--dur) ease-quint transition-colors"
            >
              Pricing
            </Link>
          </nav>

          <div className="flex items-center gap-(--gap-xs)">
            <PaletteSwitcher />
            <Button variant="ghost" size="sm" render={<Link href="/sign-in">Sign in</Link>} />
            <Button size="sm" render={<Link href="/sign-up">Get started</Link>} />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-border border-t">
        <div className="mx-auto flex max-w-measure flex-col gap-(--gap-lg) px-(--pad-page) py-(--pad-card) sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-(--gap-xs)">
            <p className="[font:var(--t-h2)]">Operato</p>
            <p className="text-small text-muted-foreground">
              Ask your restaurant a question. Get a straight answer.
            </p>
          </div>

          <nav
            aria-label="Footer"
            className="text-small text-muted-foreground flex flex-wrap items-center gap-(--gap-lg)"
          >
            <Link
              href="/pricing"
              className="hover:text-foreground duration-(--dur) ease-quint transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/sign-in"
              className="hover:text-foreground duration-(--dur) ease-quint transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="hover:text-foreground duration-(--dur) ease-quint transition-colors"
            >
              Get started
            </Link>
          </nav>

          <p className="text-small text-muted-foreground">
            &copy; {new Date().getFullYear()} Operato. Made in India, billed in ₹.
          </p>
        </div>
      </footer>
    </div>
  );
}
