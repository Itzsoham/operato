import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowRight,
  CalendarClock,
  ChefHat,
  MessageSquareText,
  PackageSearch,
  Receipt,
  Package,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMemberships, getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Operato — The AI operating system for your restaurant",
  description:
    "Ask a plain-English question, get an answer from your real sales, inventory and customers. Operato is the AI operating system for restaurants — text-to-SQL chat, weekly auto-summaries, and smart inventory alerts, plus menu, orders, inventory and CRM in one dashboard.",
  openGraph: {
    title: "Operato — The AI operating system for your restaurant",
    description:
      "An AI assistant that talks to your actual restaurant data — not a demo dataset. Text-to-SQL chat, weekly summaries, smart inventory alerts.",
    type: "website",
  },
};

const AI_FEATURES = [
  {
    icon: MessageSquareText,
    title: "Ask Operato",
    description:
      "“Who were my top 10 customers this month?” Type a plain-English question and Operato writes and runs the SQL against your real data, then answers in seconds.",
  },
  {
    icon: CalendarClock,
    title: "Monday morning summary",
    description:
      "An AI-written recap of sales, top items and trends lands on your dashboard every week, automatically. No prompts, no setup.",
  },
  {
    icon: PackageSearch,
    title: "Smart inventory alerts",
    description:
      "Operato tracks sales velocity per item and tells you how many days of stock are left — and exactly how much to reorder, before you run out.",
  },
] as const;

const CORE_MODULES = [
  { icon: ChefHat, label: "Menu" },
  { icon: Receipt, label: "Orders & tables" },
  { icon: Package, label: "Inventory" },
  { icon: Users, label: "Customers" },
] as const;

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Set up",
    description: "Add your menu, tables and inventory — or load demo data in seconds.",
  },
  {
    step: "2",
    title: "Ask",
    description: "Type a question in plain English, right from your dashboard.",
  },
  {
    step: "3",
    title: "Act",
    description: "Get an answer, a chart, or an alert — and make the call.",
  },
] as const;

const TESTIMONIALS = [
  {
    quote:
      "I stopped exporting spreadsheets just to find out what sold on the weekend. Now I just ask.",
    name: "Owner",
    role: "a Bangalore café",
  },
  {
    quote: "The Monday summary is the first thing I read with my coffee. It's usually right.",
    name: "Manager",
    role: "a Pune QSR chain",
  },
  {
    quote: "Told me I'd run out of paneer in four days before I noticed. Reordered the same day.",
    name: "Owner",
    role: "a Mumbai cloud kitchen",
  },
] as const;

const FAQ = [
  {
    question: "Is my data safe?",
    answer:
      "Every restaurant's data is isolated at the database level, not just in application code — so one tenant's data can never leak into another's, including through the AI assistant.",
  },
  {
    question: "Do I need a POS integration?",
    answer:
      "No. Operato works standalone: add your menu, orders and inventory directly, or load demo data to try it out before committing to real numbers.",
  },
  {
    question: "Can I switch plans later?",
    answer:
      "Yes. Start free with no card required, and move to Pro whenever the daily AI limit starts to feel small.",
  },
  {
    question: "What devices does it work on?",
    answer: "Any modern browser — desktop at the back office, tablet at the counter.",
  },
] as const;

/**
 * The traffic controller now lives here instead of the bare `/` page: same redirect
 * rules for a signed-in user, but a signed-out visitor gets the marketing landing page
 * instead of a bounce to /sign-in. See src/lib/session.ts for the cache()d helpers.
 */
export default async function MarketingHomePage() {
  const session = await getSession();

  if (session) {
    const memberships = await getMemberships(session.user.id);
    if (memberships.length === 0) redirect("/onboarding");
    redirect(`/${memberships[0].restaurantId}`);
  }

  return (
    <>
      {/* Hero */}
      <section className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 pt-16 pb-20 text-center sm:px-6 sm:pt-24 sm:pb-28">
        <Badge variant="secondary">AI-native SaaS for restaurants</Badge>

        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          The AI operating system for your restaurant
        </h1>

        <p className="text-muted-foreground max-w-2xl text-base text-balance sm:text-lg">
          Ask a plain-English question, get an answer from your real sales, inventory and
          customers — no spreadsheets, no analyst, no waiting.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button size="lg" render={<Link href="/sign-up">Get started free <ArrowRight /></Link>} />
          <Button
            variant="outline"
            size="lg"
            render={<Link href="/sign-in">Sign in</Link>}
          />
        </div>

        <p className="text-muted-foreground text-xs">No credit card required.</p>
      </section>

      {/* Differentiator */}
      <section className="border-y bg-muted/40">
        <p className="text-muted-foreground mx-auto max-w-3xl px-4 py-6 text-center text-sm font-medium sm:px-6">
          Talks to your <span className="text-foreground">actual</span> restaurant data — not a
          canned demo dataset.
        </p>
      </section>

      {/* AI features */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            An AI assistant that actually knows your business
          </h2>
          <p className="text-muted-foreground mt-3 text-base">
            Three features, one job: turn your data into decisions without you having to ask
            someone else to pull a report.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {AI_FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardContent className="flex flex-col gap-3">
                <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
                  <feature.icon className="size-4.5" />
                </div>
                <h3 className="font-heading text-base font-medium">{feature.title}</h3>
                <p className="text-muted-foreground text-sm">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Core modules */}
      <section className="border-t bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-lg font-medium">
            Plus the day-to-day basics, all in one dashboard
          </h2>

          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {CORE_MODULES.map((module) => (
              <div
                key={module.label}
                className="bg-card ring-foreground/10 flex flex-col items-center gap-2 rounded-xl py-6 text-center ring-1"
              >
                <module.icon className="text-muted-foreground size-5" />
                <span className="text-sm font-medium">{module.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
          How it works
        </h2>

        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="flex flex-col items-center gap-3 text-center">
              <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full text-sm font-semibold">
                {item.step}
              </div>
              <h3 className="font-heading text-base font-medium">{item.title}</h3>
              <p className="text-muted-foreground text-sm">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-t bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Restaurant owners, not analysts
          </h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-center text-sm">
            Illustrative feedback from the kind of owner Operato is built for.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {TESTIMONIALS.map((testimonial) => (
              <Card key={testimonial.quote}>
                <CardContent className="flex flex-col gap-4">
                  <p className="text-sm text-balance">&ldquo;{testimonial.quote}&rdquo;</p>
                  <div className="mt-auto">
                    <p className="text-sm font-medium">{testimonial.name}</p>
                    <p className="text-muted-foreground text-xs">{testimonial.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
          Frequently asked
        </h2>

        <dl className="mt-10 flex flex-col gap-8">
          {FAQ.map((item) => (
            <div key={item.question}>
              <dt className="font-heading text-base font-medium">{item.question}</dt>
              <dd className="text-muted-foreground mt-2 text-sm">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Final CTA */}
      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Ready?</h2>
          <p className="text-muted-foreground max-w-xl text-base">
            Set up your restaurant and start asking questions in the next five minutes.
          </p>
          <Button size="lg" render={<Link href="/sign-up">Start free — no card needed <ArrowRight /></Link>} />
        </div>
      </section>
    </>
  );
}
