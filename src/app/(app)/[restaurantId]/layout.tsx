import { requirePageMember } from "@/lib/session";

/**
 * Tenant guard for every PAGE under /[restaurantId].
 *
 * Defense in depth, not the primary control: each page still calls requirePageMember
 * itself. This exists so that isolation does not silently depend on every future page
 * remembering to. A layout DOES run for the page tree — which is precisely why the same
 * trick does NOT work for route handlers under app/api/**, where a layout never runs and
 * every handler must call requireMember (see src/lib/auth-guard.ts).
 *
 * Cheap: requirePageMember's session lookup is deduped per request by React cache().
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
  await requirePageMember(restaurantId); // 404s a non-member before any child renders
  return <>{children}</>;
}
