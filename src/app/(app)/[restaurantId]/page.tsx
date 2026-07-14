import { UserMenu } from "@/components/auth/user-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePageMember, requireSession } from "@/lib/session";

// Placeholder shell — the real sidebar, nav and restaurant switcher land in step 3.
// It exists now so the auth flow can be walked end to end.

export default async function RestaurantHomePage({
  params,
}: {
  // Next 16: params is a Promise.
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const session = await requireSession();
  const { membership } = await requirePageMember(restaurantId);

  // Tenant-filtered, always. `restaurantId` came from the URL and was just checked
  // against this user's memberships — never from the request body.
  const [orders, customers, menuItems] = await Promise.all([
    prisma.order.count({ where: { restaurantId } }),
    prisma.customer.count({ where: { restaurantId } }),
    prisma.menuItem.count({ where: { restaurantId } }),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex flex-col">
          <span className="font-semibold">{membership.name}</span>
          <span className="text-muted-foreground text-xs">{membership.role.toLowerCase()}</span>
        </div>
        <UserMenu
          name={session.user.name}
          email={session.user.email}
          image={session.user.image}
        />
      </header>

      <main className="flex-1 p-6">
        <Card>
          <CardHeader>
            <CardTitle>You&apos;re in.</CardTitle>
            <CardDescription>
              Auth and tenant membership are working. The dashboard lands next.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-8 text-sm">
            <div>
              <div className="text-2xl font-semibold">{orders.toLocaleString("en-IN")}</div>
              <div className="text-muted-foreground">orders</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{customers.toLocaleString("en-IN")}</div>
              <div className="text-muted-foreground">customers</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{menuItems}</div>
              <div className="text-muted-foreground">menu items</div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
