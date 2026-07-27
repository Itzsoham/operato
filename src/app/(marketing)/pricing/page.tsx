import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing · Operato",
  description:
    "Simple, two-tier pricing for Operato — the AI operating system for restaurants. Start free with no card required, upgrade to Pro for unlimited-feeling AI queries, weekly summaries and priority support.",
  openGraph: {
    title: "Pricing · Operato",
    description:
      "Start free with no card required, upgrade to Pro for unlimited-feeling AI queries, weekly summaries and priority support.",
    type: "website",
  },
};

type Plan = {
  id: "FREE" | "PRO";
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "FREE",
    name: "Free",
    price: "₹0",
    cadence: "forever",
    description: "Everything you need to run one restaurant on Operato.",
    features: [
      "Menu, orders & tables, inventory and customer CRM",
      "One restaurant",
      "Up to 10 Ask Operato questions per day",
      "Analytics dashboard",
      "Email support",
    ],
    cta: "Start for free",
  },
  {
    id: "PRO",
    name: "Pro",
    price: "₹999",
    cadence: "/ month",
    description: "For restaurants that want the AI features on tap, every day.",
    features: [
      "Everything in Free",
      "Up to 200 Ask Operato questions per day",
      "Automatic weekly AI business summary",
      "Smart inventory reorder alerts",
      "Priority support",
    ],
    cta: "Upgrade to Pro",
    highlighted: true,
  },
];

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Simple pricing
        </h1>
        <p className="text-muted-foreground mt-4 text-base sm:text-lg">
          Start free, no card required. Upgrade when the daily AI limit starts to feel small.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <Card
            key={plan.id}
            className={cn(plan.highlighted && "ring-2 ring-primary")}
          >
            <CardHeader>
              {plan.highlighted ? (
                <Badge className="mb-2 w-fit">Most popular</Badge>
              ) : null}
              <CardTitle className="text-lg">{plan.name}</CardTitle>
              <CardDescription>{plan.description}</CardDescription>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                <span className="text-muted-foreground text-sm">{plan.cadence}</span>
              </div>
            </CardHeader>

            <CardContent className="flex-1">
              <ul className="flex flex-col gap-3 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="text-foreground mt-0.5 size-4 shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>

            <CardFooter className="border-t-0 bg-transparent px-(--card-spacing) pb-(--card-spacing)">
              <Button
                className="w-full"
                variant={plan.highlighted ? "default" : "outline"}
                render={<Link href="/sign-up">{plan.cta}</Link>}
              />
            </CardFooter>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground mx-auto mt-8 max-w-md text-center text-xs text-balance">
        Both plans start from the same sign-up flow. You can move to Pro from inside your
        dashboard whenever you&apos;re ready.
      </p>
    </section>
  );
}
