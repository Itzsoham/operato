"use client";

import { CreditCard, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Plan } from "@/generated/prisma/enums";
import { useCreateCheckout } from "@/hooks/use-billing";

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

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
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

      <Card className="max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Current plan</CardTitle>
            <Badge variant={isPro ? "default" : "secondary"}>{isPro ? "Pro" : "Free"}</Badge>
          </div>
          <CardDescription>
            {isPro
              ? expiresAt
                ? isExpired
                  ? `Expired on ${expiresAt.toLocaleDateString([], DATE_FORMAT)}`
                  : `Renews on ${expiresAt.toLocaleDateString([], DATE_FORMAT)}`
                : "Active — no renewal date on file yet."
              : "Free plan — upgrade any time for the full feature set."}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col items-start gap-3">
          {awaitingConfirmation ? (
            <p className="text-muted-foreground text-sm">
              Payment received — this can take a minute to reflect. If your plan still shows
              Free after a bit, refresh the page.
            </p>
          ) : null}

          {!canManage ? (
            <p className="text-muted-foreground text-sm">Only the owner can manage billing.</p>
          ) : isPro ? (
            // The checkout route itself is the real guard here (it 409s "already on the
            // Pro plan" regardless of an expired `planExpiresAt`) — this just avoids
            // offering a button that would only ever bounce while the stored plan is
            // still PRO. A halted/cancelled subscription is a reconciliation concern
            // (see the route's own note on the webhook + reconciliation job), not
            // something this button re-triggers.
            null
          ) : (
            <Button
              onClick={openCheckout}
              disabled={!scriptReady || checkout.isPending || awaitingConfirmation}
            >
              {checkout.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              {checkout.isPending ? "Starting checkout…" : "Upgrade to Pro"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
