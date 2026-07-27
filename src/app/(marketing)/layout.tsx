import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Public chrome for the marketing site: a sticky nav + footer, no sidebar, no auth
 * guard. Every page in this route group is reachable by a signed-out visitor, which is
 * the point — this is the page a restaurant owner hits *before* they have an account.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Operato
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
            <Link href="/" className="transition-colors hover:text-foreground">
              Home
            </Link>
            <Link href="/pricing" className="transition-colors hover:text-foreground">
              Pricing
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" render={<Link href="/sign-in">Sign in</Link>} />
            <Button size="sm" render={<Link href="/sign-up">Get started</Link>} />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-sm font-semibold tracking-tight">Operato</p>
            <p className="text-muted-foreground text-xs">
              The AI operating system for restaurants.
            </p>
          </div>

          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/pricing" className="transition-colors hover:text-foreground">
              Pricing
            </Link>
            <Link href="/sign-in" className="transition-colors hover:text-foreground">
              Sign in
            </Link>
            <Link href="/sign-up" className="transition-colors hover:text-foreground">
              Get started
            </Link>
          </nav>

          <p className="text-muted-foreground text-xs">
            &copy; {new Date().getFullYear()} Operato. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
