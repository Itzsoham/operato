import {
  ChefHat,
  CreditCard,
  LayoutDashboard,
  Package,
  Receipt,
  Sparkles,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

/**
 * The dashboard's navigation, as DATA rather than JSX.
 *
 * This is the platform seam. "Restaurant" is vertical #1 — a clinic or a salon gets the
 * same shell with a different list (Menu -> Services, Tables -> Rooms). Keeping it as a
 * plain array means a vertical swaps a config file, not a component tree. See
 * src/lib/verticals/ when the second vertical lands.
 *
 * `href` is relative to /[restaurantId]; the sidebar prefixes the tenant.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "", label: "Overview", icon: LayoutDashboard },
  // The flagship feature — a text-to-SQL assistant over the tenant's real data — sits
  // right under Overview, not buried after the operational modules.
  { href: "/assistant", label: "Ask AI", icon: Sparkles },
  { href: "/menu", label: "Menu", icon: ChefHat },
  { href: "/orders", label: "Orders", icon: Receipt },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/staff", label: "Staff", icon: UsersRound },
  { href: "/customers", label: "Customers", icon: Users },
  // Billing is a once-in-a-while stop (checking the plan, upgrading), not a daily
  // operational module — kept last, after the modules staff touch every shift.
  { href: "/billing", label: "Billing", icon: CreditCard },
];
