import {
  ChefHat,
  LayoutDashboard,
  Package,
  Receipt,
  Users,
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
  { href: "/menu", label: "Menu", icon: ChefHat },
  { href: "/orders", label: "Orders", icon: Receipt },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/customers", label: "Customers", icon: Users },
];
