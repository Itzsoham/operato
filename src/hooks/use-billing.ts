"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * The success shape of `POST /billing/checkout` — see the route for why there is no
 * request body and no GET counterpart yet (the current plan is read server-side, off the
 * restaurant's own row, by the billing page itself).
 */
export type CheckoutSession = {
  subscriptionId: string;
  keyId: string;
  restaurantName: string;
  contactEmail: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.fieldErrors
      ? Object.values(body.fieldErrors as Record<string, string>)[0]
      : (body?.error ?? `Request failed (${res.status})`);
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const base = (restaurantId: string) => `/api/restaurants/${restaurantId}/billing`;

// ── mutations ────────────────────────────────────────────────────────────────

/**
 * Starts (or resumes — see the route's REUSABLE_STATUSES) a Pro subscription mandate.
 * No request body: everything the server needs comes from the URL param and the OWNER's
 * own session, same shape as usePayOrder in use-orders.ts and useInventoryAlert in
 * use-inventory.ts.
 *
 * Nothing to invalidate here on success: this only creates a PENDING Razorpay subscription
 * and hands back Checkout.js's `subscription_id` + the public key. It does NOT flip the
 * restaurant's plan — that happens later, out of band, once the `/api/webhooks/razorpay`
 * route confirms the charge. The caller (billing-client.tsx) is responsible for opening
 * Checkout.js with the returned session and for telling the owner that confirmation is
 * asynchronous.
 */
export function useCreateCheckout(restaurantId: string) {
  return useMutation({
    mutationFn: () => request<CheckoutSession>(`${base(restaurantId)}/checkout`, { method: "POST" }),
    onError: (e: Error) => toast.error(e.message),
  });
}
