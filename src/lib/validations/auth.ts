import { z } from "zod";

// One schema per input, shared by the client form and the server that trusts nothing.
// The client copy is a convenience; the server copy is the guard.

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80, "That name is too long"),
  email: z.email("Enter a valid email address").toLowerCase(),
  // Better Auth's own floor is 8; keep them in step or sign-up fails server-side with a
  // message the user never sees.
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(128, "That password is too long"),
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email address").toLowerCase(),
  password: z.string().min(1, "Enter your password"),
});

/**
 * Names that must never become a tenant slug.
 *
 * The onboarding form already promises `operato.app/{slug}`, so slug-based routing is
 * coming. On that day a restaurant called "sign-in" would shadow a real route. Reserve
 * them now, while the table is empty — doing it later means migrating live tenants.
 */
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "billing", "dashboard", "docs", "help", "login",
  "logout", "new", "onboarding", "pricing", "settings", "signin", "sign-in", "signout",
  "sign-out", "signup", "sign-up", "static", "support", "webhooks", "www",
]);

/** Slugs are public and appear in URLs — keep them boring and predictable. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "At least 2 characters")
  .max(48, "At most 48 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens only")
  .refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved. Try another.");

export const createRestaurantSchema = z.object({
  name: z.string().trim().min(2, "Enter the restaurant's name").max(80, "That name is too long"),
  slug: slugSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;

/** "The Spice Garden!" -> "the-spice-garden" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
