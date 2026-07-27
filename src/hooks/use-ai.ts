"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

export type AiUsage = {
  used: number;
  limit: number;
  remaining: number;
};

/**
 * The full shape of a successful `/ai/query` POST. `rows` is intentionally
 * `Record<string, unknown>[]` — the columns are whatever the model's generated SELECT
 * happened to project, so there is no fixed schema to type them against on the client.
 */
export type AiAnswer = {
  question: string;
  sql: string;
  explanation: string;
  rows: Record<string, unknown>[];
  truncated: boolean;
  /** The natural-language answer — the main thing to show. */
  answer: string;
  usage: AiUsage;
};

/** Every key starts with restaurantId — see the note in use-menu.ts. */
export const aiKeys = {
  usage: (restaurantId: string): QueryKey => [restaurantId, "ai", "usage"],
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

const base = (restaurantId: string) => `/api/restaurants/${restaurantId}/ai/query`;

/**
 * GET — no model call, just a count against `AiQuery`. Safe to fire on mount so the page
 * can show "X of Y questions left today" before anyone asks anything.
 */
export function useAiUsage(restaurantId: string) {
  return useQuery({
    queryKey: aiKeys.usage(restaurantId),
    queryFn: () => request<AiUsage>(base(restaurantId)),
  });
}

/**
 * POST — single-turn Q&A. The body is the question itself, raw, NOT `{ question }`: the
 * route validates it with `aiQuestionSchema`, which parses a bare string.
 *
 * Not optimistic — there is nothing to guess. Every attempt (success or failure) spends
 * from the day's quota, so the usage query is invalidated `onSettled` rather than only
 * `onSuccess`.
 */
export function useAskAi(restaurantId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (question: string) =>
      request<AiAnswer>(base(restaurantId), {
        method: "POST",
        body: JSON.stringify(question),
      }),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: aiKeys.usage(restaurantId) });
    },
  });
}
