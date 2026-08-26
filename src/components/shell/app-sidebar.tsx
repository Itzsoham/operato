"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { UserMenu } from "@/components/auth/user-menu";
import { RestaurantSwitcher } from "@/components/shell/restaurant-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NAV_ITEMS, type NavItem } from "@/lib/nav";
import type { Membership } from "@/lib/session";

/**
 * THE SECTIONS. The mockups all split the rail into two ruled groups — Crema calls them
 * "Counter" and "The shop" — because eight flat links is a list, not a navigation.
 *
 * Grouping lives HERE and not in lib/nav.ts on purpose: nav.ts is the vertical seam (a
 * clinic gets Rooms instead of Tables) and it stays a plain, ungrouped array of routes.
 * Anything nav.ts adds that this map does not name still renders — it falls into the
 * last section rather than disappearing, which is the failure mode that matters.
 */
const SECTIONS: { label: string; hrefs: string[] }[] = [
  { label: "Counter", hrefs: ["", "/assistant", "/menu", "/orders"] },
  { label: "The shop", hrefs: ["/inventory", "/staff", "/customers", "/billing"] },
];

function sections(): { label: string; items: NavItem[] }[] {
  const claimed = new Set(SECTIONS.flatMap((s) => s.hrefs));
  const orphans = NAV_ITEMS.filter((item) => !claimed.has(item.href));

  return SECTIONS.map((section, index) => ({
    label: section.label,
    items: [
      ...NAV_ITEMS.filter((item) => section.hrefs.includes(item.href)),
      ...(index === SECTIONS.length - 1 ? orphans : []),
    ],
  })).filter((section) => section.items.length > 0);
}

export function AppSidebar({
  memberships,
  current,
  user,
}: {
  memberships: Membership[];
  current: Membership;
  user: { name: string; email: string; image?: string | null };
}) {
  const pathname = usePathname();
  const base = `/${current.restaurantId}`;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* THE WORDMARK TILE. The glyph is the letter itself, set in --font-heading, so
            the brand mark re-cuts per palette exactly as the display type does: Crema's
            Iowan serif, Forno's Arial Black 900, Lievito's Futura 200, Saffron's
            Palatino. --grad-brand is documented as the wordmark tile's own gradient and
            carries --brand-foreground, which is the pair that was contrast-measured. */}
        <Link
          href={base}
          className="flex min-w-0 items-center gap-sm rounded-md p-1 group-data-[collapsible=icon]:p-0"
          title="Operato"
        >
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand bg-[image:var(--grad-brand)] font-heading text-h2 text-brand-foreground shadow-xs"
            aria-hidden
          >
            O
          </span>
          <span className="min-w-0 group-data-[collapsible=icon]:sr-only">
            <span className="block truncate font-heading text-h2 leading-none text-sidebar-foreground">
              Operato
            </span>
            <span className="mt-1 block truncate text-label tracking-label text-sidebar-foreground uppercase">
              Restaurant OS
            </span>
          </span>
        </Link>

        <RestaurantSwitcher memberships={memberships} current={current} />
      </SidebarHeader>

      <SidebarContent>
        {sections().map((section, index) => (
          <SidebarGroup
            key={section.label}
            // In the rail the labels are clipped away, so the groups are told apart by a
            // hairline instead — the mockups' `.nav-group + .nav-group::before`.
            className={
              index > 0
                ? "group-data-[collapsible=icon]:border-t group-data-[collapsible=icon]:border-sidebar-border group-data-[collapsible=icon]:pt-sm"
                : undefined
            }
          >
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const href = `${base}${item.href}`;
                  // Overview is the tenant root, so an exact match — otherwise it would
                  // light up on every child route. The rest match their subtree.
                  const isActive =
                    item.href === "" ? pathname === base : pathname.startsWith(href);

                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={
                          // aria-current is the non-visual half of the active state: the
                          // ceramic lift, the left rule and the weight change are all
                          // colour and form, and none of them reach a screen reader.
                          <Link href={href} aria-current={isActive ? "page" : undefined}>
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu name={user.name} email={user.email} image={user.image} />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
