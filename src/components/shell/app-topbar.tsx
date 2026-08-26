"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PaletteSwitcher } from "@/components/shell/palette-switcher";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NAV_ITEMS } from "@/lib/nav";

/**
 * THE TOP BAR — the app's one persistent chrome strip, mounted by the tenant layout so
 * that no page can forget it.
 *
 * It used to be part of PageHeader, which meant the sidebar trigger and the appearance
 * control were re-declared by every page: forget one on a phone viewport and the
 * navigation is simply unreachable on that screen. Chrome belongs to the shell.
 *
 * Height is --pad-head (`p-head`), the palette's own chrome rhythm — 14px/20px in Crema,
 * tighter in Forno, looser in Lievito. The bar is --card over the page's --app-bg
 * ground, separated by the 1px --border rule that is Lievito's entire ledger vocabulary.
 */
export function AppTopBar({
  restaurantId,
  restaurantName,
}: {
  restaurantId: string;
  restaurantName: string;
}) {
  const pathname = usePathname();
  const base = `/${restaurantId}`;

  // The deepest nav route this URL sits under. Overview is the tenant root, so it only
  // matches exactly; everything else owns its subtree.
  const section = NAV_ITEMS.filter((item) =>
    item.href === "" ? pathname === base : pathname.startsWith(`${base}${item.href}`),
  ).sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <header
      data-slot="app-topbar"
      className="animate-rise sticky top-0 z-30 flex shrink-0 items-center gap-sm border-b border-border bg-card p-head text-card-foreground shadow-xs"
    >
      {/* Shown below 1024 (it opens the drawer) and again at 1280 (it collapses the
          sidebar). Hidden on the rail rung in between, where the rail IS the layout and
          there is nothing to toggle — the mockups hide the hamburger there too. */}
      <SidebarTrigger className="flex lg:hidden xl:flex" />
      <Separator orientation="vertical" className="h-4 lg:hidden xl:block" />

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-xs">
          <li className="min-w-0 shrink truncate">
            <Link
              href={base}
              className="truncate text-small text-muted-foreground transition-colors duration-(--dur) ease-quint hover:text-foreground"
            >
              {restaurantName}
            </Link>
          </li>
          {section ? (
            <>
              <li aria-hidden className="text-muted-foreground select-none">
                /
              </li>
              {/* --text-chrome exists for exactly this: the strip's own title. It is
                  deliberately small — the page's real title is the masthead h1 below. */}
              <li className="min-w-0 truncate font-heading text-chrome" aria-current="page">
                {section.label}
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <PaletteSwitcher />
    </header>
  );
}
