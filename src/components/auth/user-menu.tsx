"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  // `theme` (not `resolvedTheme`) — it must show "System" as selected when that's what
  // the user picked, not whichever of light/dark the OS currently resolves it to.
  const { theme, setTheme } = useTheme();

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
          <Button variant="ghost" className="size-8 rounded-full p-0" aria-label="Account">
            <Avatar className="size-8">
              {image ? <AvatarImage src={image} alt="" /> : null}
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        {/* Base UI throws "MenuGroupContext is missing" if a Label sits outside a Group
            — at RUNTIME, on open, which a build will never catch. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate font-medium">{name}</span>
            <span className="text-muted-foreground truncate text-xs font-normal">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} disabled={pending}>
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
