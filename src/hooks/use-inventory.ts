"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import type { TransactionType } from "@/generated/prisma/enums";
import type {
  CreateInventoryItemInput,
  CreateMovementInput,
} from "@/lib/validations/inventory";

export type StockLine = {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  costPerUnit: number | null;
  supplier: string | null;
  dailyUsage: number;
  daysLeft: number | null;
  needsReorder: boolean;
};

export type Movement = {
  id: string;
  type: TransactionType;
  /** Positive magnitude, for display. */
  quantity: number;
  /** SIGNED contribution to the balance. This is the one that reconciles — see the
   *  schema. Never derive a sign from `type`: a stock-take can go either way. */
  delta: number;
  balanceAfter: number;
  notes: string | null;
  createdAt: string;
  /** Who moved it. Null if that user has since been deleted. */
  user: { name: string } | null;
};

/** Every key starts with restaurantId — see the note in use-menu.ts. */
export const inventoryKeys = {
  stock: (restaurantId: string): QueryKey => [restaurantId, "inventory"],
  movements: (restaurantId: string, itemId: string): QueryKey => [
    restaurantId,
    "inventory",
    itemId,
    "movements",
  ],
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

const base = (restaurantId: string) => `/api/restaurants/${restaurantId}/inventory`;

export function useStock(restaurantId: string) {
  return useQuery({
    queryKey: inventoryKeys.stock(restaurantId),
    queryFn: () => request<StockLine[]>(base(restaurantId)),
  });
}

export function useMovements(restaurantId: string, itemId: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.movements(restaurantId, itemId ?? ""),
    queryFn: () => request<Movement[]>(`${base(restaurantId)}/${itemId}/movements`),
    enabled: Boolean(itemId),
  });
}

export function useCreateInventoryItem(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInventoryItemInput) =>
      request<StockLine>(base(restaurantId), {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.stock(restaurantId) });
      toast.success("Item added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApplyMovement(restaurantId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMovementInput) =>
      request<Movement>(`${base(restaurantId)}/${itemId}/movements`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (movement) => {
      // The stock list carries every item's balance AND its velocity — both just moved.
      qc.invalidateQueries({ queryKey: inventoryKeys.stock(restaurantId) });
      qc.invalidateQueries({ queryKey: inventoryKeys.movements(restaurantId, itemId) });
      toast.success(`Recorded — ${movement.balanceAfter} in stock`);
    },
    // NOT optimistic. The server computes the new balance under a row lock, and it can
    // legitimately refuse (you cannot take out 12kg when 9 are there). Guessing the
    // balance and then correcting it would show a stock level that never existed.
    onError: (e: Error) => toast.error(e.message),
  });
}
