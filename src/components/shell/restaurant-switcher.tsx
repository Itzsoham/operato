"use client";

import { ChevronsUpDown, Plus, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Membership } from "@/lib/session";

export function RestaurantSwitcher({
  memberships,
  current,
}: {
  memberships: Membership[];
  current: Membership;
}) {
  const router = useRouter();
  const { isMobile } = useSidebar();

  function switchTo(restaurantId: string) {
    if (restaurantId === current.restaurantId) return;
    // A full navigation to the other tenant's root, not a client-side patch of the
    // current tree: every Server Component below is scoped to the OLD restaurantId and
    // must be re-fetched. Swapping only the id in place is how one tenant's cached rows
    // end up rendered under another tenant's name.
    router.push(`/${restaurantId}`);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Store className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{current.name}</span>
                  <span className="text-muted-foreground truncate text-xs capitalize">
                    {current.role.toLowerCase()}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            }
          />

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {/* Base UI requires a Label to live inside a Group — outside one it throws
                "MenuGroupContext is missing" at runtime, not at build time. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Restaurants
              </DropdownMenuLabel>

              {memberships.map((m) => (
                <DropdownMenuItem
                  key={m.restaurantId}
                  onClick={() => switchTo(m.restaurantId)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <Store className="size-3.5 shrink-0" />
                  </div>
                  <span className="truncate">{m.name}</span>
                  {m.restaurantId === current.restaurantId ? (
                    <span className="text-muted-foreground ml-auto text-xs">current</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={
                <Link href="/onboarding" className="gap-2 p-2">
                  <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                    <Plus className="size-4" />
                  </div>
                  <span className="text-muted-foreground font-medium">Add restaurant</span>
                </Link>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
