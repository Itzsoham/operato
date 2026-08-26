import { cookies } from "next/headers";

import { Providers } from "@/components/providers";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopBar } from "@/components/shell/app-topbar";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
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
        {/* The shell's chrome is mounted ONCE, here, instead of by every page: the
            sidebar trigger is the only way into the navigation below 1024px, and a page
            that forgets to render it is a page you cannot leave. */}
        <AppTopBar restaurantId={restaurantId} restaurantName={membership.name} />

        {/* THE ENTRANCE. `.rise` is translateY + opacity staggered by --i at --stagger:
            the top bar arrives first, the page body a beat later. globals.css zeroes the
            duration AND the delay under prefers-reduced-motion — without the delay reset
            a reduced-motion visitor sits looking at opacity:0 for the whole stagger.

            The column is deliberately NOT centred on --measure yet: PageHeader's band
            is full-bleed and its copy sits on the page gutter, so centring only this
            wrapper would leave every title indented away from the cards beneath it.
            The measure moves in when the page bodies themselves adopt it.

            max-lg:pb-24 reserves the bottom tab bar's strip. The bar is fixed, so
            without it the last row of every page hides underneath the tabs. */}
        <div
          className="rise flex w-full min-w-0 flex-1 flex-col max-lg:pb-24"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <Providers>{children}</Providers>
        </div>

        <BottomTabBar restaurantId={restaurantId} />
      </SidebarInset>
    </SidebarProvider>
  );
}
