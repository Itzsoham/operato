import { z } from "zod";

// No `.default()` on any base that later gets `.partial()`d — Zod 4's partial does not
// strip a default, so a PATCH of one field silently rewrites the others. See
// tests/unit/validations.test.ts.

/**
 * A phone number is REQUIRED, and that is a product decision, not a formality.
 *
 * The schema has `@@unique([restaurantId, phone])` with `phone` nullable — and in Postgres
 * NULLs are DISTINCT, so that constraint does nothing to stop a hundred phone-less
 * "customers". Auto-creating a Customer for every walk-in would fill the CRM with
 * anonymous duplicates, inflate the customer count, and wreck the very "top customers"
 * and "new customers this month" figures the CRM exists to report.
 *
 * So: an order without a phone simply carries `customerId = null`. It is still counted in
 * revenue; it is just not attributed to a person. That is the honest answer.
 */
/**
 * Canonicalises a phone number to E.164 (+919876543210).
 *
 * WHY THIS IS NOT COSMETIC. `@@unique([restaurantId, phone])` is a unique index on the
 * RAW STRING. Without normalisation, "+91 98765 43210", "9876543210", "+919876543210" and
 * "098765 43210" are four different values — so one human becomes four rows, their spend
 * is split four ways, and "top customers" (the report the CRM exists to produce) is simply
 * wrong. The friendly "you already have a customer with that number" would never fire, and
 * search would fail to find a number typed with different spacing.
 *
 * Canonicalise, do NOT reject: the input gate stays permissive, because refusing a real
 * customer's number to enforce a format is the wrong trade. Formatting for display belongs
 * in the UI, never in the database.
 */
export function normalisePhone(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;

  const digits = cleaned.replace(/^0+/, ""); // a leading trunk zero is not part of the number
  if (digits.length === 10) return `+91${digits}`; // India is the default; see Restaurant.currency
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

const phone = z
  .string()
  .trim()
  .min(6, "That doesn't look like a phone number")
  .max(20, "That's too long")
  // Permissive on the way in: +91, spaces, hyphens and brackets are all things people type.
  .regex(/^[+\d][\d\s()-]*$/, "Digits, spaces, + and - only")
  // Canonical on the way to the database.
  .transform(normalisePhone);

const customerFields = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80, "That name is too long"),
  phone,
  email: z.email("Not a valid email").nullish(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
});

export const createCustomerSchema = customerFields;

/**
 * Editing a customer CANNOT touch totalSpend, visitCount or lastVisitAt.
 *
 * Those are DERIVED — rolled up from paid orders inside the payment transaction, under a
 * row lock (see src/lib/orders/service.ts). A PATCH able to set them would let anyone
 * rewrite a customer's lifetime spend with no order to explain it, which is the same
 * mistake as letting a PATCH set an inventory balance with no movement behind it.
 */
export const updateCustomerSchema = customerFields.partial();

export const listCustomersSchema = z.object({
  search: z.string().trim().max(80).nullish(),
  /** "regulars" first, by lifetime spend — the question the CRM is actually for. */
  sort: z.enum(["spend", "recent", "name"]).default("spend"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
