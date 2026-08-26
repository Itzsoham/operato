"use client";

import { AlertTriangle, Check, CreditCard, Loader2, Lock, Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useState } from "react";
import { toast } from "sonner";

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
import type { Plan } from "@/generated/prisma/enums";
import { useCreateCheckout } from "@/hooks/use-billing";
import { cn } from "@/lib/utils";

const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/**
 * Razorpay Checkout.js is a plain third-party `<script>` global, not an npm package — it
 * ships no TypeScript types. This is only the slice of its documented options object this
 * component actually uses (confirmed against the checkout route's response fields: a
 * `subscription_id`, NOT `order_id`, because this mints a recurring subscription mandate,
 * not a one-off order).
 */
type RazorpayCheckoutOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  prefill: { email: string };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
  modal: { ondismiss: () => void };
};

type RazorpayCheckoutInstance = { open: () => void };

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "long" };

/**
 * The two plan cards. Copy is lifted VERBATIM from the public pricing page
 * (src/app/(marketing)/pricing/page.tsx) so the in-app cards and the marketing page can
 * never quote different limits or a different price at the same customer. ₹999/month is
 * the canonical Pro figure; the real amount is still confirmed by Razorpay at checkout.
 */
const PLAN_CARDS = [
  {
    id: "FREE" as const,
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
  },
  {
    id: "PRO" as const,
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
  },
];

/**
 * A plain helper, not inlined in the component body — same split as `elapsedLabel` in
 * staff-client.tsx. `Date.now()` is an impure call; React's purity rule flags it when it
 * sits directly in a component's render body (it did here, until this was pulled out),
 * but not when it's tucked inside an ordinary function the component merely calls.
 */
function isExpiredAt(expiresAt: Date | null): boolean {
  return expiresAt ? expiresAt.getTime() < Date.now() : false;
}

export function BillingClient({
  restaurantId,
  plan,
  planExpiresAt,
  canManage,
}: {
  restaurantId: string;
  plan: Plan;
  /** ISO string, or null on FREE (and on a fresh PRO subscription with no cycle yet). */
  planExpiresAt: string | null;
  /**
   * OWNER only — the checkout route itself is gated the same way (`roles: [MemberRole.OWNER]`
   * in billing/checkout/route.ts), tighter than the usual "manager can do most things" bar
   * this dashboard draws elsewhere (see canManage in staff-client.tsx, canAdjust in
   * inventory-client.tsx). This prop just hides the control; the server is the real guard.
   */
  canManage: boolean;
}) {
  const router = useRouter();
  const [scriptReady, setScriptReady] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const checkout = useCreateCheckout(restaurantId);

  const isPro = plan === "PRO";
  const expiresAt = planExpiresAt ? new Date(planExpiresAt) : null;
  const isExpired = isExpiredAt(expiresAt);

  function openCheckout() {
    // Captured into a local BEFORE the async mutation — window.Razorpay is a mutable global
    // property, and TypeScript cannot narrow it as non-null across the mutation's onSuccess
    // closure, only a local const it captures by reference.
    const RazorpayCtor = window.Razorpay;
    if (!scriptReady || !RazorpayCtor) {
      toast.error("Payment isn't ready yet — try again in a moment.");
      return;
    }

    checkout.mutate(undefined, {
      onSuccess: ({ subscriptionId, keyId, restaurantName, contactEmail }) => {
        const rzp = new RazorpayCtor({
          key: keyId,
          subscription_id: subscriptionId,
          name: "Operato",
          description: `${restaurantName} — Pro plan`,
          prefill: { email: contactEmail },
          handler: () => {
            // response.razorpay_payment_id / razorpay_subscription_id / razorpay_signature
            // are NOT proof of an activated plan — the actual flip happens server-side,
            // asynchronously, once /api/webhooks/razorpay confirms the charge. Show a
            // "hang on" state rather than claiming success here.
            setAwaitingConfirmation(true);
            // Best-effort, not live polling (proportionate per the task spec): one extra
            // shot at re-running this Server Component's data fetch a few seconds out, in
            // case the webhook has already landed by then. If it hasn't, the copy below
            // tells the owner to refresh manually — there is no polling loop beyond this.
            setTimeout(() => router.refresh(), 4000);
          },
          modal: {
            ondismiss: () => {
              // Closed without paying — not an error, just stop showing a pending state.
            },
          },
        });
        rzp.open();
      },
    });
  }

  // The upgrade control renders in exactly one place — the Pro card's footer — but its
  // enabled/disabled logic is unchanged from before the redesign: OWNER only, script
  // loaded, not already mid-checkout, not already waiting on the webhook.
  const showUpgrade = canManage && !isPro;
  const upgradeDisabled = !scriptReady || checkout.isPending || awaitingConfirmation;

  return (
    // `wrap` is the page column (--measure, centred); px-page / py-lg are the palette's
    // own gutter and rhythm. It used to be a bare `p-4`, a stock step no palette moved.
    <div className="wrap flex w-full flex-1 flex-col gap-lg px-page py-lg">
      {/* afterInteractive: needed only once the owner clicks "Upgrade", but this dashboard
          route is never the LCP-critical path, so there is no reason to defer it further
          with lazyOnload and add a second delay on top of the click. */}
      <Script
        src={CHECKOUT_SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() =>
          toast.error("Couldn't load the payment provider. Refresh the page and try again.")
        }
      />

      {/* THE STATE STRIP — the one thing an owner opens this page to read: what plan am I
          on, and when does it turn over. Painted with --grad-card-brand, the wash every
          palette declares for the money / identity card. */}
      <Card
        className="rise bg-[image:var(--grad-card-brand)] border-brand"
        style={{ "--i": 0 } as React.CSSProperties}
      >
        <CardContent className="flex flex-wrap items-start justify-between gap-lg">
          <div className="flex min-w-0 flex-col gap-xs">
            <p className="text-label tracking-label text-muted-foreground uppercase">
              Current plan
            </p>
            <div className="flex flex-wrap items-center gap-sm">
              <p className="font-heading text-h2 text-card-foreground">
                {isPro ? "Pro" : "Free"}
              </p>
              <PlanStatusBadge isPro={isPro} isExpired={isExpired} />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-xs sm:text-right">
            <p className="text-label tracking-label text-muted-foreground uppercase">
              {isPro ? (isExpired ? "Expired" : "Renews") : "Billing"}
            </p>
            {/* Dates are figures: --font-num with tabular-nums, so the column does not
                jitter and the palette's numeral face actually gets used. */}
            <p className="font-num text-body text-card-foreground tabular-nums">
              {isPro
                ? expiresAt
                  ? expiresAt.toLocaleDateString([], DATE_FORMAT)
                  : "No renewal date on file yet"
                : "Nothing to pay"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── THE NOTICES ─────────────────────────────────────────────────────────────
          Three mutually exclusive rungs, each on its own semantic -subtle triple (an
          opaque wash, ink measured on it, an opaque edge) rather than an alpha guess
          over an unknown ground. Every one of them carries an icon and a heading, so
          the state is never signalled by colour alone. */}
      {awaitingConfirmation ? (
        <Notice
          tone="info"
          icon={<Loader2 className="size-5 shrink-0 animate-spin" aria-hidden="true" />}
          title="Payment received — confirming with the bank"
          testId="billing-awaiting-notice"
        >
          This can take a minute to reflect. If your plan still shows Free after a bit,
          refresh the page.
        </Notice>
      ) : null}

      {checkout.isError && !awaitingConfirmation ? (
        <Notice
          tone="destructive"
          icon={<AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
          title="Checkout could not be started"
          testId="billing-error-notice"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openCheckout}
              disabled={upgradeDisabled}
            >
              Try again
            </Button>
          }
        >
          {checkout.error.message}
        </Notice>
      ) : null}

      {!canManage ? (
        <Notice
          tone="muted"
          icon={<Lock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
          title="Only the owner can manage billing"
          testId="billing-readonly-notice"
        >
          You can see the plan this restaurant is on, but changing it is the owner&apos;s
          to do.
        </Notice>
      ) : null}

      {/* ── THE PLANS ───────────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-sm">
        <SectionHead label="Plans" />

        <div className="grid gap-lg md:grid-cols-2">
          {PLAN_CARDS.map((entry, i) => {
            const isCurrent = entry.id === plan;
            return (
              <Card
                key={entry.id}
                data-testid={`billing-plan-${entry.id.toLowerCase()}`}
                // The current plan is marked THREE ways at once — a border in --brand, a
                // badge that says so in words, and aria-current — because a ring alone is
                // a colour-only signal.
                aria-current={isCurrent ? "true" : undefined}
                className={cn("rise flex flex-col", isCurrent && "border-brand shadow-lg")}
                style={{ "--i": i + 1 } as React.CSSProperties}
              >
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-xs">
                    <CardTitle>{entry.name}</CardTitle>
                    {isCurrent ? (
                      <Badge variant="secondary">
                        <span data-slot="badge-dot" aria-hidden="true" />
                        Current plan
                      </Badge>
                    ) : null}
                  </div>
                  <CardDescription>{entry.description}</CardDescription>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-sm">
                  {/* The price is the screen's one figure, so it is the screen's one
                      --t-metric: the palette's numeral face, tabular, with the cadence
                      held down at --t-small beside it. */}
                  <p className="flex items-baseline gap-xs">
                    <span className="font-num text-metric text-card-foreground tabular-nums">
                      {entry.price}
                    </span>
                    <span className="text-small text-muted-foreground">{entry.cadence}</span>
                  </p>

                  <ul className="flex flex-col gap-xs">
                    {entry.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-xs text-body">
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-success"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter>
                  {entry.id === "PRO" && showUpgrade ? (
                    // The one primary CTA on this screen, so it is the one control
                    // allowed --sh-brand. Behaviour, disabled logic and copy are
                    // unchanged from before the redesign.
                    <Button
                      onClick={openCheckout}
                      className="w-full shadow-brand"
                      disabled={upgradeDisabled}
                    >
                      {checkout.isPending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <CreditCard className="size-4" aria-hidden="true" />
                      )}
                      {checkout.isPending ? "Starting checkout…" : "Upgrade to Pro"}
                    </Button>
                  ) : (
                    <p className="text-small text-muted-foreground">
                      {isCurrent
                        ? "You are on this plan."
                        : entry.id === "PRO"
                          ? "Ask the owner to upgrade."
                          : "Included with every account."}
                    </p>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* The loading rung of the CTA: Checkout.js is a third-party script, and until it
            lands the button above is disabled for a reason the owner cannot otherwise
            see. animate-shimmer is the system's loading motion — opacity only. */}
        {showUpgrade && !scriptReady ? (
          <p
            className="animate-shimmer text-small text-muted-foreground"
            aria-live="polite"
            data-testid="billing-script-loading"
          >
            Preparing the secure checkout…
          </p>
        ) : null}
      </section>

      {/* ── INVOICES ────────────────────────────────────────────────────────────────
          There is no invoice list to render — Razorpay issues and mails them, and this
          app stores no copy. An honest empty state says so rather than leaving a blank
          slot the owner reads as "broken". */}
      <section className="flex flex-col gap-sm">
        <SectionHead label="Invoices" />

        <Card className="rise border-dashed shadow-none" style={{ "--i": 3 } as React.CSSProperties}>
          <CardContent className="flex flex-col items-center gap-xs py-lg text-center">
            <div className="flex size-tap items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Receipt className="size-5" aria-hidden="true" />
            </div>
            <p className="font-heading text-h2">
              {isPro ? "Invoices are mailed to the owner" : "No invoices yet"}
            </p>
            <p className="max-w-measure text-body text-muted-foreground">
              {isPro
                ? "Every charge on this subscription is invoiced by Razorpay and emailed to the billing contact on file."
                : "The Free plan is never charged, so there is nothing to invoice. Invoices start with your first Pro payment."}
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/**
 * The mockups' section head: an eyebrow label and a hairline running to the far edge.
 * The rule is --border, the only ink a divider is allowed to use.
 */
function SectionHead({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-sm">
      <h2 className="text-label tracking-label text-muted-foreground uppercase">{label}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

function PlanStatusBadge({ isPro, isExpired }: { isPro: boolean; isExpired: boolean }) {
  if (!isPro) {
    return (
      <Badge variant="secondary" data-testid="billing-status-badge">
        <span data-slot="badge-dot" aria-hidden="true" />
        Free plan
      </Badge>
    );
  }
  if (isExpired) {
    return (
      <Badge variant="destructive" data-testid="billing-status-badge">
        <span data-slot="badge-dot" aria-hidden="true" />
        Expired
      </Badge>
    );
  }
  return (
    <Badge data-testid="billing-status-badge">
      <span data-slot="badge-dot" aria-hidden="true" />
      Active
    </Badge>
  );
}

/**
 * One banner shape, three semantic tones. Each is the palette's own -subtle triple, so a
 * palette switch re-tints AND re-shapes it (Crema soft and elevated, Forno a hard 5px
 * offset, Lievito a bare hairline, Saffron an engraved plate).
 */
function Notice({
  tone,
  icon,
  title,
  children,
  action,
  testId,
}: {
  tone: "info" | "destructive" | "muted";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  testId: string;
}) {
  return (
    <Card
      role={tone === "destructive" ? "alert" : "status"}
      data-testid={testId}
      className={cn(
        "animate-rise",
        tone === "info" && "border-border bg-info-subtle text-info-subtle-foreground",
        tone === "destructive" &&
          "border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground",
        tone === "muted" && "border-border bg-muted text-muted-foreground"
      )}
    >
      <CardContent className="flex flex-wrap items-start gap-sm">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <p className="font-heading text-h2">{title}</p>
          <p className="text-body">{children}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
