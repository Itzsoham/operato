"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { RestaurantSwitcher } from "@/components/shell/restaurant-switcher";
import { UserMenu } from "@/components/auth/user-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NAV_ITEMS } from "@/lib/nav";
import type { Membership } from "@/lib/session";

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
        <RestaurantSwitcher memberships={memberships} current={current} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
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
                        <Link href={href}>
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
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2 px-1 py-1">
            <UserMenu name={user.name} email={user.email} image={user.image} />
            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-medium">{user.name}</span>
              <span className="text-muted-foreground truncate text-xs">{user.email}</span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
