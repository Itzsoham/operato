import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMemberships, requireSession } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your restaurant · Operato" };

export default async function OnboardingPage() {
  const session = await requireSession();
  const memberships = await getMemberships(session.user.id);

  // Reachable on purpose by someone who already has restaurants — this is also the
  // "add another restaurant" route, so it must NOT bounce them away.
  const isFirst = memberships.length === 0;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{isFirst ? "Set up your restaurant" : "Add a restaurant"}</CardTitle>
            <CardDescription>
              {isFirst
                ? `Welcome, ${session.user.name.split(" ")[0]}. One more step.`
                : "You'll be its owner."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
