import "server-only";

import type { z } from "zod";

import { serialize } from "@/lib/serialize";

/**
 * Route-handler plumbing shared by every module. Kept boring on purpose: the interesting
 * decisions (who are you, which tenant) live in auth-guard.ts, and the interesting data
 * lives in the module. This is just the shape of a reply.
 */

/** 200 with a body, Decimals and BigInts already flattened. */
export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json(serialize(data), init);
}

export function created<T>(data: T): Response {
  return ok(data, { status: 201 });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function notFound(message = "Not found"): Response {
  return Response.json({ error: message }, { status: 404 });
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * 422 with per-field messages, in the shape the client forms already render.
 * Zod's `issues` carry the path, so the form can put the message under the right input
 * instead of dumping one blob at the top.
 */
export function invalid(error: z.ZodError): Response {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return Response.json({ error: "Validation failed", fieldErrors }, { status: 422 });
}

/**
 * Parses a JSON body against a schema.
 *
 * Returns a discriminated result rather than throwing, so a handler cannot accidentally
 * proceed with unvalidated input — there is no shape of this function's return value
 * that gives you `data` without having checked `ok`.
 */
export async function parseJson<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: badRequest("Expected a JSON body") };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: invalid(parsed.error) };

  return { ok: true, data: parsed.data };
}
