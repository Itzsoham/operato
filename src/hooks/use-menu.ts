"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  CreateCategoryInput,
  CreateMenuItemInput,
  UpdateMenuItemInput,
} from "@/lib/validations/menu";

export type Category = {
  id: string;
  name: string;
  sortOrder: number;
  _count: { menuItems: number };
};

export type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number; // Decimal, flattened to a number by src/lib/serialize.ts
  categoryId: string | null;
  category: { id: string; name: string } | null;
  isAvailable: boolean;
  isVeg: boolean;
  preparationTime: number | null;
  sortOrder: number;
};

/**
 * EVERY query key starts with the restaurantId.
 *
 * This is not tidiness. TanStack's cache outlives a client-side navigation, and React
 * preserves client components by tree position — so a key of ["menu-items"] would serve
 * restaurant A's dishes under restaurant B's name after a switch. The tenant layout also
 * remounts the subtree on `key={restaurantId}` as a backstop, but the key is the actual
 * fix: caches must not be able to collide across tenants in the first place.
 */
export type MenuFilters = { search?: string; categoryId?: string; available?: boolean };

export const menuKeys = {
  categories: (restaurantId: string): QueryKey => [restaurantId, "menu", "categories"],
  /**
   * The FILTERS are part of the key. A key of just [rid, "menu", "items"] would serve
   * the results of a filtered fetch as if they were the full list — every filter variant
   * collides on one cache entry, and the UI shows a subset while believing it has
   * everything.
   *
   * `items(rid)` (no filters) is the prefix of every filtered key, so invalidating it
   * invalidates all of them. That is how the mutations below stay simple.
   */
  items: (restaurantId: string, filters?: MenuFilters): QueryKey =>
    filters && Object.keys(filters).length > 0
      ? [restaurantId, "menu", "items", filters]
      : [restaurantId, "menu", "items"],
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    // The API answers 422 with per-field messages and 400/403/404 with `error`. Surface
    // the server's sentence — it is the one that knows why.
    const body = await res.json().catch(() => null);
    const message =
      body?.error === "Validation failed" && body.fieldErrors
        ? Object.values(body.fieldErrors as Record<string, string>)[0]
        : (body?.error ?? `Request failed (${res.status})`);
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const base = (restaurantId: string) => `/api/restaurants/${restaurantId}/menu`;

// ── queries ──────────────────────────────────────────────────────────────────

export function useCategories(restaurantId: string) {
  return useQuery({
    queryKey: menuKeys.categories(restaurantId),
    queryFn: () => request<Category[]>(`${base(restaurantId)}/categories`),
  });
}

export function useMenuItems(restaurantId: string, filters?: MenuFilters) {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.categoryId) params.set("categoryId", filters.categoryId);
  if (filters?.available !== undefined) params.set("available", String(filters.available));
  const query = params.toString();

  return useQuery({
    queryKey: menuKeys.items(restaurantId, filters),
    queryFn: () =>
      request<MenuItem[]>(`${base(restaurantId)}/items${query ? `?${query}` : ""}`),
    // Keep showing the previous list while a new search flies, so the table doesn't
    // blank out on every keystroke.
    placeholderData: (previous) => previous,
  });
}

// ── mutations ────────────────────────────────────────────────────────────────

export function useCreateCategory(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      request<Category>(`${base(restaurantId)}/categories`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: menuKeys.categories(restaurantId) });
      toast.success("Category added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCategory(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`${base(restaurantId)}/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: menuKeys.categories(restaurantId) });
      qc.invalidateQueries({ queryKey: menuKeys.items(restaurantId) });
      toast.success("Category deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateMenuItem(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMenuItemInput) =>
      request<MenuItem>(`${base(restaurantId)}/items`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: menuKeys.items(restaurantId) });
      qc.invalidateQueries({ queryKey: menuKeys.categories(restaurantId) }); // item counts
      toast.success("Item added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateMenuItem(restaurantId: string) {
  const qc = useQueryClient();
  // The PREFIX of every items key, filtered or not — see menuKeys.items.
  const prefix = menuKeys.items(restaurantId);

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateMenuItemInput & { id: string }) =>
      request<MenuItem>(`${base(restaurantId)}/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    // Optimistic: the availability toggle must feel instant. Snapshot first so a failure
    // can put the old value back — without the rollback, a rejected write leaves the UI
    // confidently showing a state the server never accepted.
    //
    // setQueriesData (plural) patches EVERY cached items query — the unfiltered list and
    // any filtered ones. Patching a single exact key would miss whichever variant the
    // user is actually looking at.
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: prefix });
      const previous = qc.getQueriesData<MenuItem[]>({ queryKey: prefix });

      qc.setQueriesData<MenuItem[]>({ queryKey: prefix }, (old) =>
        old?.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );

      return { previous };
    },

    onError: (error: Error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) qc.setQueryData(key, data);
      toast.error(error.message);
    },

    // Reconcile with the server either way: the optimistic row is a guess. It also can't
    // know derived fields — patching `categoryId` doesn't update the nested `category`
    // object the table renders, so the badge would show the old name until this refetch.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: prefix });
      qc.invalidateQueries({ queryKey: menuKeys.categories(restaurantId) });
    },
  });
}

export function useDeleteMenuItem(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`${base(restaurantId)}/items/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: menuKeys.items(restaurantId) });
      qc.invalidateQueries({ queryKey: menuKeys.categories(restaurantId) });
      toast.success("Item deleted");
    },
    // Not optimistic on purpose: the server REFUSES to delete a dish that appears in past
    // orders (FK RESTRICT). Removing the row first and putting it back would flash a
    // deletion that never happened.
    onError: (e: Error) => toast.error(e.message),
  });
}
