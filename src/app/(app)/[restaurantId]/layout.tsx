import { cookies } from "next/headers";

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
      {/* key={restaurantId} forces the whole tenant subtree to REMOUNT when you switch
          restaurants, rather than re-rendering in place.

          Today nothing under here holds client state, so this is free. It stops being
          free the moment a TanStack QueryClientProvider or a client-side data table
          appears: React preserves client components by tree POSITION across a soft
          navigation, so restaurant A's cached rows would survive the switch and render
          under restaurant B's name. Paying for it now, while it costs one line.
          (Query keys must still be prefixed with restaurantId — this is the backstop,
          not the excuse.) */}
      <SidebarInset key={restaurantId}>{children}</SidebarInset>
    </SidebarProvider>
  );
}
