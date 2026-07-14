"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import type { CreateCustomerInput, UpdateCustomerInput } from "@/lib/validations/customers";

export type Customer = {
  id: string;
  name: string;
  /** Required and canonical (+919876543210) — see normalisePhone(). Never null. */
  phone: string;
  /** DERIVED from paid orders, under a row lock. Never editable. */
  totalSpend: number;
  visitCount: number;
  lastVisitAt: string | null;
  tags: string[];
  createdAt: string;
};

/** The list endpoint deliberately does NOT return `email` — see the route. */
export type CustomerDetail = Customer & {
  email: string | null;
  orders: {
    id: string;
    orderNumber: string;
    totalAmount: number;
    paidAt: string | null;
    orderItems: { quantity: number; menuItem: { name: string } }[];
  }[];
};

export type CustomerSort = "spend" | "recent" | "name";

/** Every key starts with restaurantId — see the note in use-menu.ts. */
export const customerKeys = {
  list: (restaurantId: string, filters?: Record<string, unknown>): QueryKey =>
    filters && Object.keys(filters).length > 0
      ? [restaurantId, "customers", filters]
      : [restaurantId, "customers"],
  detail: (restaurantId: string, id: string): QueryKey => [restaurantId, "customers", id],
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

const base = (restaurantId: string) => `/api/restaurants/${restaurantId}/customers`;

export function useCustomers(
  restaurantId: string,
  filters: { search?: string; sort?: CustomerSort },
) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.sort) params.set("sort", filters.sort);
  const query = params.toString();

  return useQuery({
    queryKey: customerKeys.list(restaurantId, filters as Record<string, unknown>),
    queryFn: () =>
      request<Customer[]>(`${base(restaurantId)}${query ? `?${query}` : ""}`),
    // Keep the previous list on screen while a new search flies, so the table doesn't
    // blank out on every keystroke.
    placeholderData: (previous) => previous,
  });
}

export function useCustomer(restaurantId: string, id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.detail(restaurantId, id ?? ""),
    queryFn: () => request<CustomerDetail>(`${base(restaurantId)}/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateCustomer(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      request<Customer>(base(restaurantId), {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customerKeys.list(restaurantId) });
      toast.success("Customer added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCustomer(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCustomerInput & { id: string }) =>
      request<Customer>(`${base(restaurantId)}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (customer) => {
      qc.invalidateQueries({ queryKey: customerKeys.list(restaurantId) });
      qc.invalidateQueries({ queryKey: customerKeys.detail(restaurantId, customer.id) });
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
