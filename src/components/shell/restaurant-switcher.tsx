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
              // THE BUSINESS SWITCHER (mockups §4): a hairline card sitting ON the rail,
              // two lines — name over role — with a chevron. It is a raised surface, not
              // a nav row, so it carries --sidebar-accent + a border + --sh-xs even at
              // rest, and collapses to just its tile in the rail.
              <SidebarMenuButton
                size="lg"
                aria-label={`Switch business — currently ${current.name}, you are the ${current.role.toLowerCase()}`}
                className="rounded-lg border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-xs data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand-subtle-foreground">
                  <Store className="size-4" />
                </div>
                <div className="grid min-w-0 flex-1 text-left">
                  <span className="truncate text-body font-semibold">{current.name}</span>
                  {/* 11px uppercase is small text: it takes the full sidebar foreground,
                      never a tint — Forno's rail is charred in LIGHT mode, where a muted
                      ink would vanish. */}
                  <span className="truncate text-label tracking-label text-sidebar-foreground uppercase">
                    {current.role.toLowerCase()}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            }
          />

          <DropdownMenuContent
            className="min-w-64"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {/* Base UI requires a Label to live inside a Group — outside one it throws
                "MenuGroupContext is missing" at runtime, not at build time. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Restaurants</DropdownMenuLabel>

              {memberships.map((m) => (
                <DropdownMenuItem
                  key={m.restaurantId}
                  onClick={() => switchTo(m.restaurantId)}
                  className="gap-sm"
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-xs border border-border bg-muted">
                    <Store className="size-3.5 shrink-0" />
                  </div>
                  <span className="truncate">{m.name}</span>
                  {m.restaurantId === current.restaurantId ? (
                    <span className="ml-auto text-label tracking-label text-muted-foreground uppercase">
                      current
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            {/* nativeButton={false} — this navigates, so it renders an anchor; Base UI
                warns otherwise because its default assumes a real <button>. */}
            <DropdownMenuItem
              nativeButton={false}
              render={
                <Link href="/onboarding" className="gap-sm">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-xs border border-border bg-transparent">
                    <Plus className="size-4" />
                  </div>
                  <span className="font-semibold">Add restaurant</span>
                </Link>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
