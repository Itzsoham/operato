"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import type { OrderStatus, TableStatus } from "@/generated/prisma/enums";
import type { CreateOrderInput, CreateTableInput } from "@/lib/validations/orders";

export type OrderLine = {
  id: string;
  menuItemId: string;
  quantity: number;
  unitPrice: number; // Decimal, flattened by src/lib/serialize.ts
  totalPrice: number;
  notes: string | null;
  menuItem: { name: string; isVeg: boolean };
};

export type Order = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  paidAt: string | null;
  orderItems: OrderLine[];
  table: { id: string; number: number; label: string | null } | null;
  customer: { id: string; name: string; phone: string | null } | null;
};

export type FloorTable = {
  id: string;
  number: number;
  label: string | null;
  capacity: number;
  status: TableStatus;
  orders: { id: string; orderNumber: string; status: OrderStatus; totalAmount: number }[];
};

/** Every key starts with restaurantId — see the note in use-menu.ts. */
export const orderKeys = {
  orders: (restaurantId: string, filters?: Record<string, unknown>): QueryKey =>
    filters && Object.keys(filters).length > 0
      ? [restaurantId, "orders", filters]
      : [restaurantId, "orders"],
  tables: (restaurantId: string): QueryKey => [restaurantId, "tables"],
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body?.fieldErrors
        ? Object.values(body.fieldErrors as Record<string, string>)[0]
        : (body?.error ?? `Request failed (${res.status})`);
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const base = (restaurantId: string) => `/api/restaurants/${restaurantId}`;

// ── queries ──────────────────────────────────────────────────────────────────

export function useOrders(restaurantId: string, filters?: { open?: boolean }) {
  const params = new URLSearchParams();
  if (filters?.open !== undefined) params.set("open", String(filters.open));
  const query = params.toString();

  return useQuery({
    queryKey: orderKeys.orders(restaurantId, filters as Record<string, unknown>),
    queryFn: () =>
      request<Order[]>(`${base(restaurantId)}/orders${query ? `?${query}` : ""}`),
    placeholderData: (previous) => previous,
  });
}

export function useTables(restaurantId: string) {
  return useQuery({
    queryKey: orderKeys.tables(restaurantId),
    queryFn: () => request<FloorTable[]>(`${base(restaurantId)}/tables`),
  });
}

// ── mutations ────────────────────────────────────────────────────────────────

/** Anything that changes an order also changes the floor. Refresh both, always. */
function useOrderInvalidation(restaurantId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orderKeys.orders(restaurantId) });
    qc.invalidateQueries({ queryKey: orderKeys.tables(restaurantId) });
  };
}

export function useCreateOrder(restaurantId: string) {
  const invalidate = useOrderInvalidation(restaurantId);
  return useMutation({
    mutationFn: (input: CreateOrderInput) =>
      request<Order>(`${base(restaurantId)}/orders`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (order) => {
      invalidate();
      toast.success(`${order.orderNumber} placed`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateOrderStatus(restaurantId: string) {
  const invalidate = useOrderInvalidation(restaurantId);
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      request<Order>(`${base(restaurantId)}/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (order) => {
      invalidate();
      toast.success(`${order.orderNumber} → ${order.status.toLowerCase()}`);
    },
    // NOT optimistic. The server enforces which transitions are legal, and showing a
    // status it is about to reject would be a lie that has to be taken back.
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePayOrder(restaurantId: string) {
  const invalidate = useOrderInvalidation(restaurantId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      request<Order>(`${base(restaurantId)}/orders/${id}/pay`, { method: "POST" }),
    onSuccess: (order) => {
      invalidate();
      // Paying moves money into the customer's lifetime spend — the CRM is now stale.
      qc.invalidateQueries({ queryKey: [restaurantId, "customers"] });
      toast.success(`${order.orderNumber} paid — ₹${order.totalAmount.toLocaleString("en-IN")}`);
    },
    // Emphatically NOT optimistic. This is money. If two tills settle the same bill, the
    // server rejects the second ("already paid") — showing it as settled first, then
    // snatching it back, is the one place a rollback is unacceptable.
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateTable(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTableInput) =>
      request<FloorTable>(`${base(restaurantId)}/tables`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.tables(restaurantId) });
      toast.success("Table added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
