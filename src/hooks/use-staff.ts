"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import type { StaffRole } from "@/generated/prisma/enums";
import type {
  ClockInInput,
  ClockOutInput,
  CreateStaffInput,
  UpdateStaffInput,
} from "@/lib/validations/staff";

export type Staff = {
  id: string;
  restaurantId: string;
  name: string;
  role: StaffRole;
  email: string | null;
  phone: string | null;
  /** Decimal(10,2), flattened to a number by src/lib/serialize.ts. */
  salary: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Shift = {
  id: string;
  staffId: string;
  restaurantId: string;
  startTime: string;
  /** null while the shift is open. */
  endTime: string | null;
  /** Decimal(5,2), flattened to a number. null until clock-out computes it. */
  hoursWorked: number | null;
  notes: string | null;
  createdAt: string;
};

/**
 * Every key starts with restaurantId — see the note in use-menu.ts. `shifts` is further
 * prefixed by staffId, so invalidating the unfiltered shifts key for one staff member
 * cannot touch another's cache entry.
 */
export const staffKeys = {
  list: (restaurantId: string, filters?: Record<string, unknown>): QueryKey =>
    filters && Object.keys(filters).length > 0
      ? [restaurantId, "staff", filters]
      : [restaurantId, "staff"],
  shifts: (restaurantId: string, staffId: string, filters?: Record<string, unknown>): QueryKey =>
    filters && Object.keys(filters).length > 0
      ? [restaurantId, "staff", staffId, "shifts", filters]
      : [restaurantId, "staff", staffId, "shifts"],
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

const base = (restaurantId: string) => `/api/restaurants/${restaurantId}/staff`;

// ── queries ──────────────────────────────────────────────────────────────────

export function useStaff(restaurantId: string, filters?: { active?: boolean }) {
  const params = new URLSearchParams();
  if (filters?.active !== undefined) params.set("active", String(filters.active));
  const query = params.toString();

  return useQuery({
    queryKey: staffKeys.list(restaurantId, filters as Record<string, unknown>),
    queryFn: () => request<Staff[]>(`${base(restaurantId)}${query ? `?${query}` : ""}`),
    // Keep the previous roster on screen while the active/inactive filter flies, so the
    // table doesn't blank out on every toggle.
    placeholderData: (previous) => previous,
  });
}

/**
 * One staff member's attendance history, most recent first. Doubles as "are they clocked
 * in right now" — the first row is the open shift if `endTime` is still null — which is
 * why every roster row calls this rather than the list carrying it: the roster endpoint
 * doesn't (and shouldn't) join every staff member's shifts just to answer that.
 */
export function useShifts(
  restaurantId: string,
  staffId: string | undefined,
  filters?: { limit?: number },
) {
  const params = new URLSearchParams();
  if (filters?.limit) params.set("limit", String(filters.limit));
  const query = params.toString();

  return useQuery({
    queryKey: staffKeys.shifts(restaurantId, staffId ?? "", filters as Record<string, unknown>),
    queryFn: () =>
      request<Shift[]>(`${base(restaurantId)}/${staffId}/shifts${query ? `?${query}` : ""}`),
    enabled: Boolean(staffId),
  });
}

// ── mutations ────────────────────────────────────────────────────────────────

export function useCreateStaff(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) =>
      request<Staff>(base(restaurantId), {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: staffKeys.list(restaurantId) });
      toast.success("Staff member added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Edits a staff member's details (including flipping `isActive` back on — see
 * deactivateStaff's doc comment in the service). Optimistic, same reasoning as
 * useUpdateMenuItem: an ordinary field edit the server has no real reason to refuse.
 *
 * setQueriesData (plural) patches every cached roster query — the unfiltered list and
 * whichever active/inactive filter is on screen. A rename that fails validation server-
 * side rolls back from the snapshot; onSettled reconciles either way, since the optimistic
 * row can't know whether it now belongs under the current filter.
 */
export function useUpdateStaff(restaurantId: string) {
  const qc = useQueryClient();
  const prefix = staffKeys.list(restaurantId);

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateStaffInput & { id: string }) =>
      request<Staff>(`${base(restaurantId)}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: prefix });
      const previous = qc.getQueriesData<Staff[]>({ queryKey: prefix });

      qc.setQueriesData<Staff[]>({ queryKey: prefix }, (old) =>
        old?.map((member) => (member.id === id ? { ...member, ...patch } : member)),
      );

      return { previous };
    },

    onError: (error: Error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) qc.setQueryData(key, data);
      toast.error(error.message);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: prefix });
    },
  });
}

export function useDeactivateStaff(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<Staff>(`${base(restaurantId)}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: staffKeys.list(restaurantId) });
      toast.success("Staff member deactivated");
    },
    // NOT optimistic, same reasoning as useDeleteMenuItem/useDeleteCategory: this is a
    // soft delete the server could still legitimately refuse (no such member, wrong
    // tenant). Removing the row first and putting it back would flash a change that never
    // happened.
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Clocks a staff member in. NOT optimistic: the service takes a row lock and refuses a
 * double clock-in (see clockIn in src/lib/staff/service.ts) — a guessed "now open" shift
 * that the server rejects would show a clock-out control for a shift that never started.
 */
export function useClockIn(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, ...input }: ClockInInput & { staffId: string }) =>
      request<Shift>(`${base(restaurantId)}/${staffId}/shifts`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_shift, { staffId }) => {
      qc.invalidateQueries({ queryKey: staffKeys.shifts(restaurantId, staffId) });
      toast.success("Clocked in");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Clocks a shift out. Also not optimistic — `hoursWorked` is computed server-side under a
 * row lock, and clocking out an already-closed shift (a double-tap) is a legitimate 409.
 */
export function useClockOut(restaurantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      staffId,
      shiftId,
      ...input
    }: ClockOutInput & { staffId: string; shiftId: string }) =>
      request<Shift>(`${base(restaurantId)}/${staffId}/shifts/${shiftId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (_shift, { staffId }) => {
      qc.invalidateQueries({ queryKey: staffKeys.shifts(restaurantId, staffId) });
      toast.success("Clocked out");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

