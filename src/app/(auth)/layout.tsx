import Link from "next/link";
import { redirect } from "next/navigation";

import { PaletteSwitcher } from "@/components/shell/palette-switcher";
import { getSession } from "@/lib/session";

/**
 * The signed-out shell for sign-in and sign-up.
 *
 * APPEARANCE IS REACHABLE HERE. The palette switcher used to live only in PageHeader,
 * which covers the eight dashboard pages and nothing else — so the first two screens a
 * new user ever sees had no way to change palette or mode, and someone who prefers dark
 * got a full-brightness page until after they had signed in. The control is the SAME
 * component the app's top bar and the marketing header use, so a palette chosen here is
 * the palette you sign in to; it is parked in the corner rather than given a header,
 * because this route group has no page chrome to hang one on.
 *
 * `.bg-app` paints the palette's own ground gradient rather than a flat `bg-muted/40`,
 * which is what this used to do — a fixed 40% muted wash reads as grey paper in Forno
 * and washes out entirely on Saffron's aubergine ground.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Already signed in? The sign-in page is not somewhere you should be able to sit.
  const session = await getSession();
  if (session) redirect("/");

  return (
    <div className="bg-app relative flex min-h-svh flex-col items-center justify-center gap-lg p-page">
      {/* Corner control. Absolutely positioned so it cannot push the card off centre,
          and inset by the page rhythm so it lines up with the card's own edge. */}
      <div className="absolute top-page right-page">
        <PaletteSwitcher />
      </div>

      <Link
        href="/"
        className="font-heading text-h1 flex min-h-tap items-center tracking-tight"
      >
        Operato
      </Link>

      <div className="w-full max-w-sm">{children}</div>

      <p className="text-muted-foreground text-small max-w-sm text-center text-balance">
        The AI operating system for restaurants.
      </p>
    </div>
  );
}
