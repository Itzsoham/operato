import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  Check,
  LayoutGrid,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { PaletteDemo } from "@/components/marketing/palette-demo";
import { Button } from "@/components/ui/button";
import { getMemberships, getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Operato — ask your restaurant a question, get a straight answer",
  description:
    "Operato is an AI assistant that reads your own sales, stock and customers and answers in plain English. Weekly summaries every Monday, stock warnings before you run out, and menu, orders, inventory and regulars in one dashboard. Free to start, ₹999/month for Pro.",
  openGraph: {
    title: "Operato — ask your restaurant a question, get a straight answer",
    description:
      "An AI assistant that reads your real sales, stock and customers and answers in plain English. Weekly summaries, stock warnings, and the day-to-day in one dashboard.",
    type: "website",
  },
};

/* ── Copy ──────────────────────────────────────────────────────────────────── */

const SAMPLE_QUESTIONS = [
  "What sold best last Saturday?",
  "Which regulars haven't come back in 30 days?",
  "How many days of paneer do I have left?",
  "Did the new menu price hurt lunch?",
] as const;

const CAPABILITIES = [
  {
    icon: MessageSquareText,
    title: "Ask it anything about your own numbers",
    body: "Type the question the way you'd say it to your manager. Operato reads your own sales, stock and customer records and answers in seconds — with the figures it used, so you can check the working.",
  },
  {
    icon: CalendarClock,
    title: "A written summary every Monday",
    body: "Before you open, Operato has already gone through the week: what sold, what slipped, which day carried the takings, which regulars went quiet. It's waiting on your dashboard. Nobody has to ask for it.",
  },
  {
    icon: BellRing,
    title: "Stock that warns you first",
    body: "It watches how fast each item actually moves, not what the shelf says. You get 'three days of paneer left, order 12 kg' while there's still time to call the supplier — not after the dish comes off the board.",
  },
  {
    icon: LayoutGrid,
    title: "The day-to-day, in one place",
    body: "Menu and prices, orders and tables, inventory with a proper ledger, and the regulars who keep coming back. One login for the whole floor, on the tablet at the counter and the laptop in the back office.",
  },
] as const;

const FLOW = [
  {
    step: "1",
    title: "You ask, in your own words",
    body: "From the dashboard or your phone. No filters to set, no report to configure, no export to open in a spreadsheet.",
  },
  {
    step: "2",
    title: "Operato reads your records",
    body: "Only yours, and only to read them. It cannot change an order, a price or a stock count — and it can never see another restaurant's books.",
  },
  {
    step: "3",
    title: "You get the answer and the working",
    body: "A sentence, the numbers behind it, and a chart where a chart helps. If something looks off, the rows are right there to check.",
  },
  {
    step: "4",
    title: "You do something about it",
    body: "Reorder before the weekend. Drop the item that lost money. Call the regular who stopped coming. That's the whole point.",
  },
] as const;

const PLANS = [
  {
    id: "FREE",
    name: "Free",
    price: "₹0",
    cadence: "forever",
    tagline: "Enough to run one restaurant properly.",
    features: [
      "Menu, orders & tables, inventory, regulars",
      "10 questions a day",
      "The Monday summary",
      "One restaurant, unlimited staff logins",
    ],
    cta: "Start free",
    href: "/sign-up",
    featured: false,
  },
  {
    id: "PRO",
    name: "Pro",
    price: "₹999",
    cadence: "per month, incl. GST",
    tagline: "For when you start asking every day.",
    features: [
      "Everything in Free",
      "Far higher daily question limit",
      "Stock warnings with reorder quantities",
      "Priority support, billed in ₹ through Razorpay",
    ],
    cta: "See what Pro adds",
    href: "/pricing",
    featured: true,
  },
] as const;

/* ── Small shared pieces ───────────────────────────────────────────────────── */

/**
 * The mockups' section head: a tracked eyebrow, a display-face title, a hairline
 * rule and an optional standfirst. The rule is decorative and hidden from AT.
 */
function SectionHead({
  eyebrow,
  title,
  standfirst,
  id,
}: {
  eyebrow: string;
  title: string;
  standfirst?: string;
  id: string;
}) {
  return (
    <div className="flex flex-col gap-(--gap-sm)">
      <div className="flex items-center gap-(--gap-sm)">
        <span className="text-label tracking-label text-muted-foreground shrink-0 uppercase">
          {eyebrow}
        </span>
        <span aria-hidden className="bg-border h-px flex-1" />
      </div>
      {/* --t-h1 carries weight and face as well as size, so Lievito's 200 and
          Forno's 900 actually differ. See the note in palette-demo.tsx. */}
      <h2 id={id} className="max-w-prose text-balance [font:var(--t-h1)]">
        {title}
      </h2>
      {standfirst ? (
        <p className="text-body text-muted-foreground max-w-prose text-pretty">{standfirst}</p>
      ) : null}
    </div>
  );
}

/**
 * The traffic controller lives here rather than on a bare `/` page: same redirect
 * rules for a signed-in user, but a signed-out visitor gets the landing page instead
 * of a bounce to /sign-in. See src/lib/session.ts for the cache()d helpers.
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
      {/* ══════════════ HERO ══════════════ */}
      <section
        aria-labelledby="hero-title"
        className="border-border bg-[image:var(--grad-hero)] border-b"
      >
        <div className="mx-auto flex max-w-measure flex-col gap-(--gap-lg) px-(--pad-page) py-16 sm:py-24">
          <span className="border-brand/30 bg-card/70 text-brand-subtle-foreground text-label tracking-label animate-rise flex w-fit items-center gap-(--gap-xs) rounded-pill border px-3 py-1.5 uppercase">
            <Sparkles className="size-3.5" aria-hidden />
            For restaurants, cafés and cloud kitchens
          </span>

          <h1
            id="hero-title"
            className="animate-rise max-w-[18ch] text-balance [font:var(--t-display)]"
          >
            Ask your restaurant a question. Get a straight answer.
          </h1>

          <p className="text-body text-muted-foreground animate-rise max-w-prose text-pretty">
            Operato is an AI assistant that reads your own sales, stock and customers — not a
            demo dataset — and answers in plain English. It also writes up your week every
            Monday and tells you what to reorder before you run out.
          </p>

          <ul className="flex flex-wrap gap-(--gap-xs)" aria-label="Questions people actually ask">
            {SAMPLE_QUESTIONS.map((question) => (
              <li
                key={question}
                className="border-border bg-card/70 text-small text-muted-foreground rounded-pill border px-3 py-1.5"
              >
                &ldquo;{question}&rdquo;
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-(--gap-sm) sm:flex-row sm:items-center">
            <Button
              size="lg"
              className="h-tap text-body px-5 shadow-brand"
              render={
                <Link href="/sign-up">
                  Start free — no card
                  <ArrowRight />
                </Link>
              }
            />
            <Button
              variant="outline"
              size="lg"
              className="h-tap text-body px-5"
              render={<Link href="/sign-in">Sign in</Link>}
            />
            <p className="text-small text-muted-foreground sm:ml-(--gap-sm)">
              Free plan forever · Pro ₹999/month · billed in ₹
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════ THE PALETTE DEMO — the centrepiece ══════════════ */}
      <section
        aria-labelledby="looks-title"
        className="mx-auto flex max-w-measure flex-col gap-(--gap-lg) px-(--pad-page) py-16"
      >
        <SectionHead
          id="looks-title"
          eyebrow="Make it yours"
          title="Four looks. Pick one and watch the whole thing change."
          standfirst="A speciality coffee counter, a wood-fired pizzeria, a minimal Neapolitan room, a candlelit dining room. This isn't a colour picker — the corners, the shadows, the lettering and the spacing change too. And it isn't a mock-up either: the control below drives the real thing, so whatever you choose here is what you sign in to."
        />

        <PaletteDemo />
      </section>

      {/* ══════════════ WHAT IT DOES ══════════════ */}
      <section
        aria-labelledby="does-title"
        className="border-border bg-muted/40 border-y"
      >
        <div className="mx-auto flex max-w-measure flex-col gap-(--gap-lg) px-(--pad-page) py-16">
          <SectionHead
            id="does-title"
            eyebrow="What you get"
            title="It answers, it summarises, it warns you — and it runs the floor."
            standfirst="Four jobs, one login. Nothing here needs a POS integration or a consultant to switch on."
          />

          <div className="grid gap-(--gap-lg) md:grid-cols-2">
            {CAPABILITIES.map((capability) => (
              <article
                key={capability.title}
                className="ring-foreground/10 bg-card flex flex-col gap-(--gap-sm) rounded-3xl p-(--pad-card) shadow-sm ring-1"
              >
                <span
                  aria-hidden
                  className="bg-[image:var(--grad-brand)] text-brand-foreground grid size-9 shrink-0 place-items-center rounded-lg"
                >
                  <capability.icon className="size-4.5" />
                </span>
                <h3 className="[font:var(--t-h2)] text-balance">{capability.title}</h3>
                <p className="text-body text-muted-foreground text-pretty">{capability.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════ HOW AN ANSWER ARRIVES ══════════════ */}
      <section
        aria-labelledby="flow-title"
        className="mx-auto flex max-w-measure flex-col gap-(--gap-lg) px-(--pad-page) py-16"
      >
        <SectionHead
          id="flow-title"
          eyebrow="How an answer arrives"
          title="From a question to something you can act on, in about four seconds."
        />

        <div className="grid gap-(--gap-lg) lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <ol className="flex flex-col gap-(--gap-lg)">
            {FLOW.map((item) => (
              <li key={item.step} className="flex gap-(--gap-sm)">
                <span
                  aria-hidden
                  className="bg-primary text-primary-foreground text-chip grid size-7 shrink-0 place-items-center rounded-pill"
                >
                  {item.step}
                </span>
                <span className="flex min-w-0 flex-col gap-(--gap-xs)">
                  <h3 className="[font:var(--t-h2)]">{item.title}</h3>
                  <p className="text-body text-muted-foreground max-w-prose text-pretty">
                    {item.body}
                  </p>
                </span>
              </li>
            ))}
          </ol>

          {/* The worked example. --grad-ai is the Ask AI card's own wash. */}
          <article
            aria-label="An example question and its answer"
            className="ring-foreground/10 flex h-fit flex-col gap-(--gap-sm) rounded-3xl bg-[image:var(--grad-ai)] p-(--pad-card) shadow-md ring-1"
          >
            <span className="text-label tracking-label text-muted-foreground uppercase">
              Tuesday, 11:42
            </span>

            <p className="border-border bg-card text-code rounded-xl border px-3 py-2 font-mono">
              which items lost me money last month?
            </p>

            <p className="text-body text-pretty">
              Three lines sold below what they cost you to make. Together they took{" "}
              <strong className="font-medium">₹18,240</strong> of turnover and gave back{" "}
              <strong className="font-medium">₹2,110</strong> less than they cost.
            </p>

            <table className="text-small w-full">
              <caption className="sr-only">
                Menu lines sold below cost last month, with units sold and margin
              </caption>
              <thead>
                <tr className="text-label tracking-label text-muted-foreground uppercase">
                  <th scope="col" className="border-border border-b py-1.5 text-left">
                    Item
                  </th>
                  <th scope="col" className="border-border border-b py-1.5 text-right">
                    Sold
                  </th>
                  <th scope="col" className="border-border border-b py-1.5 text-right">
                    Margin
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  { item: "Cheese Garlic Bread", sold: "142", margin: "−₹1,180" },
                  { item: "Mango Smoothie", sold: "88", margin: "−₹620" },
                  { item: "Paneer Roll", sold: "61", margin: "−₹310" },
                ].map((row) => (
                  <tr key={row.item}>
                    <td className="border-border/60 border-b py-1.5">{row.item}</td>
                    <td className="border-border/60 border-b py-1.5 text-right tabular-nums">
                      {row.sold}
                    </td>
                    <td className="border-border/60 text-delta-down border-b py-1.5 text-right font-medium tabular-nums">
                      {row.margin}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="text-small text-muted-foreground flex items-start gap-(--gap-xs) text-pretty">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Read-only, and scoped to your restaurant alone. Operato can look at your books;
              it can&rsquo;t write in them.
            </p>
          </article>
        </div>
      </section>

      {/* ══════════════ PRICING ══════════════ */}
      <section
        aria-labelledby="pricing-title"
        className="border-border bg-muted/40 border-y"
      >
        <div className="mx-auto flex max-w-measure flex-col gap-(--gap-lg) px-(--pad-page) py-16">
          <SectionHead
            id="pricing-title"
            eyebrow="Pricing"
            title="Start free. Pay when it's earning its keep."
            standfirst="Two plans, both in rupees, both billed through Razorpay. No card to start, and nothing to cancel if you don't."
          />

          <div className="grid gap-(--gap-lg) md:grid-cols-2">
            {PLANS.map((plan) => (
              <article
                key={plan.id}
                className={
                  plan.featured
                    ? "border-brand bg-card flex flex-col gap-(--gap-sm) rounded-3xl border-2 p-(--pad-card) shadow-brand"
                    : "ring-foreground/10 bg-card flex flex-col gap-(--gap-sm) rounded-3xl p-(--pad-card) shadow-sm ring-1"
                }
              >
                <div className="flex items-center gap-(--gap-sm)">
                  <h3 className="[font:var(--t-h2)]">{plan.name}</h3>
                  {plan.featured ? (
                    <span className="bg-brand-subtle text-brand-subtle-foreground text-chip rounded-2xl px-2 py-1 uppercase">
                      Most chosen
                    </span>
                  ) : null}
                </div>

                <p className="flex items-baseline gap-(--gap-xs)">
                  <span className="[font:var(--t-metric)] tabular-nums">{plan.price}</span>
                  <span className="text-small text-muted-foreground">{plan.cadence}</span>
                </p>

                <p className="text-body text-muted-foreground text-pretty">{plan.tagline}</p>

                <ul className="flex flex-col gap-(--gap-xs)">
                  {plan.features.map((feature) => (
                    <li key={feature} className="text-body flex items-start gap-(--gap-xs)">
                      <Check className="text-brand mt-1 size-3.5 shrink-0" aria-hidden />
                      <span className="text-pretty">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  size="lg"
                  variant={plan.featured ? "default" : "outline"}
                  className="h-tap text-body mt-auto w-full px-5"
                  render={<Link href={plan.href}>{plan.cta}</Link>}
                />
              </article>
            ))}
          </div>

          <p className="text-small text-muted-foreground">
            <Link href="/pricing" className="hover:text-foreground underline underline-offset-4">
              See the full plan comparison
            </Link>
          </p>
        </div>
      </section>

      {/* ══════════════ FINAL CTA ══════════════ */}
      <section
        aria-labelledby="cta-title"
        className="mx-auto flex max-w-measure flex-col items-start gap-(--gap-lg) px-(--pad-page) py-16"
      >
        <h2 id="cta-title" className="max-w-prose text-balance [font:var(--t-h1)]">
          Set up your restaurant and ask your first question in five minutes.
        </h2>
        <p className="text-body text-muted-foreground max-w-prose text-pretty">
          Add your menu and today&rsquo;s orders, or load the demo data and poke at it first.
          Either way you&rsquo;ll know within an afternoon whether it earns its place.
        </p>
        <div className="flex flex-col gap-(--gap-sm) sm:flex-row">
          <Button
            size="lg"
            className="h-tap text-body px-5 shadow-brand"
            render={
              <Link href="/sign-up">
                Create your account
                <ArrowRight />
              </Link>
            }
          />
          <Button
            variant="outline"
            size="lg"
            className="h-tap text-body px-5"
            render={<Link href="/sign-in">I already have one</Link>}
          />
        </div>
      </section>
    </>
  );
}
