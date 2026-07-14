import { redirect } from "next/navigation";

import { getMemberships, getSession } from "@/lib/session";

/**
 * The traffic controller. Where you land depends on how far through setup you are:
 *
 *   no session      -> sign in
 *   no restaurant   -> onboarding (a signed-in user with no tenant can do nothing)
 *   has restaurant  -> their first one's dashboard
 *
 * One place decides this, so the rule cannot drift between entry points. The public
 * marketing site is a separate concern and will live under (marketing).
 */
export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const memberships = await getMemberships(session.user.id);
  if (memberships.length === 0) redirect("/onboarding");

  redirect(`/${memberships[0].restaurantId}`);
}
