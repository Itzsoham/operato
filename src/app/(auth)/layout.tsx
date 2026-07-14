import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Already signed in? The sign-in page is not somewhere you should be able to sit.
  const session = await getSession();
  if (session) redirect("/");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <Link href="/" className="text-xl font-semibold tracking-tight">
        Operato
      </Link>
      <div className="w-full max-w-sm">{children}</div>
      <p className="text-muted-foreground max-w-sm text-center text-xs text-balance">
        The AI operating system for restaurants.
      </p>
    </div>
  );
}
