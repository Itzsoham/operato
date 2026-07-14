import { cookies } from "next/headers";

import { Providers } from "@/components/providers";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requirePageMember, requireSession } from "@/lib/session";

/**
 * The dashboard shell, and the tenant guard for every PAGE under /[restaurantId].
 *
 * The guard is defense in depth, not the primary control: each page still calls
 * requirePageMember itself. This exists so isolation does not silently depend on every
 * future page remembering to. A layout DOES run for the page tree — which is precisely
 * why the same trick does NOT work for route handlers under app/api/**, where a layout
 * never runs and every handler must call requireMember (see src/lib/auth-guard.ts).
 *
 * Cheap: the session lookup inside requirePageMember is deduped per request by React
 * cache(), so the page's own call costs nothing extra.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Next 16: params is a Promise.
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const session = await requireSession();
  const { membership, memberships } = await requirePageMember(restaurantId);

  // Next 16: cookies() is a Promise. Reading the sidebar's persisted state on the
  // SERVER means the first paint already has the right layout — read it on the client
  // and the sidebar visibly snaps open or shut after hydration.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        memberships={memberships}
        current={membership}
        user={{
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
        }}
      />
      {/* key={restaurantId} REMOUNTS the whole tenant subtree when you switch
          restaurants, rather than re-rendering it in place — which is exactly what
          React would otherwise do, since it preserves client components by tree
          POSITION across a soft navigation.

          That now matters: the QueryClientProvider below lives inside the keyed subtree,
          so switching tenants throws away the entire TanStack cache along with it.
          Without the key, restaurant A's cached dishes would survive the switch and
          render under restaurant B's name.

          Belt AND braces: every query key is also prefixed with restaurantId (see
          src/hooks/use-menu.ts), so the caches cannot collide in the first place. The
          remount is the backstop, not the excuse. */}
      <SidebarInset key={restaurantId}>
        <Providers>{children}</Providers>
      </SidebarInset>
    </SidebarProvider>
  );
}
