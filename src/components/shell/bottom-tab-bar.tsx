"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/lib/nav";

/**
 * THE BOTTOM TAB BAR — the bottom rung of the responsive ladder, below 1024.
 *
 * Five slots, exactly as the mockups spec them: the four things a floor tablet touches
 * mid-service, then "More", which opens the same drawer the sidebar renders and so
 * carries every remaining module plus the account block. Nothing is reachable ONLY from
 * here — this is a shortcut over the drawer, never a second navigation.
 *
 * It is fixed, so the page reserves room for it (see the tenant layout's padding) and it
 * pads itself past the home indicator with env(safe-area-inset-bottom).
 */
const TAB_HREFS = ["", "/orders", "/assistant", "/inventory"];

export function BottomTabBar({ restaurantId }: { restaurantId: string }) {
  const pathname = usePathname();
  const { openMobile, setOpenMobile } = useSidebar();
  const base = `/${restaurantId}`;

  const tabs = TAB_HREFS.map((href) => NAV_ITEMS.find((item) => item.href === href)).filter(
    (item) => item !== undefined,
  );

  return (
    <nav
      aria-label="Primary"
      data-slot="bottom-tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-0.5 border-t border-border bg-card p-1 pb-[env(safe-area-inset-bottom)] shadow-up lg:hidden"
    >
      {tabs.map((item) => {
        const href = `${base}${item.href}`;
        const isActive = item.href === "" ? pathname === base : pathname.startsWith(href);

        return (
          <Link
            key={item.label}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "grid min-h-tap place-items-center gap-1 rounded-md px-1 py-1.5 text-center text-label tracking-normal transition-colors duration-(--dur) ease-quint",
              isActive
                ? "bg-brand-subtle text-brand-subtle-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="size-5 shrink-0" aria-hidden />
            <span className="w-full truncate">{item.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={() => setOpenMobile(!openMobile)}
        aria-expanded={openMobile}
        aria-label="More — the rest of the navigation and your account"
        className="grid min-h-tap place-items-center gap-1 rounded-md px-1 py-1.5 text-center text-label tracking-normal text-muted-foreground transition-colors duration-(--dur) ease-quint hover:bg-muted hover:text-foreground aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground"
      >
        <Menu className="size-5 shrink-0" aria-hidden />
        <span className="w-full truncate">More</span>
      </button>
    </nav>
  );
}
