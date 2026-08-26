"use client";

import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";

export function UserMenu({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const initials =
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  async function onSignOut() {
    setPending(true);
    const { error } = await signOut();
    if (error) {
      toast.error("Could not sign out. Try again.");
      setPending(false);
      return;
    }
    // A HARD navigation, deliberately — not router.push(). Signing out must discard the
    // entire Router Cache and the JS heap, both of which still hold this tenant's
    // rendered data. A soft navigation leaves that sitting in the browser of whoever
    // uses the machine next, which on a shared restaurant terminal is the whole point.
    window.location.assign("/sign-in");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // THE USER BLOCK at the foot of the rail (mockups §4): avatar, name over
          // email, chevron — one button, not an avatar sitting beside a label, so the
          // whole block is the 44px target and the name is part of the accessible name.
          //
          // The sidebar colours are named EXPLICITLY rather than inherited from the
          // ghost variant: ghost hovers to --muted, which is a page token. On Forno the
          // rail is charred in LIGHT mode and --muted is pale semolina, so the hover
          // would flash a white bar across a black panel.
          <Button
            variant="ghost"
            className="h-auto min-h-tap w-full justify-start gap-sm rounded-lg border border-sidebar-border bg-sidebar-accent px-2 py-2 text-left text-sidebar-accent-foreground shadow-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent group-data-[collapsible=icon]:size-tap group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:shadow-none"
            aria-label="Account"
          >
            <Avatar className="size-8 shrink-0">
              {image ? <AvatarImage src={image} alt="" /> : null}
              <AvatarFallback className="text-small">{initials}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 group-data-[collapsible=icon]:sr-only">
              <span className="truncate text-body font-semibold">{name}</span>
              <span className="truncate text-small font-normal text-sidebar-foreground">
                {email}
              </span>
            </span>
            {/* --sidebar-foreground, not a faint tint: this chevron is the only signal
                that the button opens a menu, so it is an affordance and needs 3:1. */}
            <ChevronsUpDown className="ml-auto size-4 shrink-0 text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" side="top" className="min-w-56">
        {/* Base UI throws "MenuGroupContext is missing" if a Label sits outside a Group
            — at RUNTIME, on open, which a build will never catch. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 normal-case tracking-normal">
            <span className="truncate text-body font-semibold text-foreground">{name}</span>
            <span className="truncate text-small font-normal text-muted-foreground">
              {email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* The Theme submenu used to live here. It moved to the PaletteSwitcher in the
            top bar (components/shell/palette-switcher.tsx) when the four-palette system
            landed: mode and palette are one decision to a user, and two controls over
            the same next-themes state is how the two surfaces drift apart. */}
        <DropdownMenuItem onClick={onSignOut} disabled={pending}>
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
