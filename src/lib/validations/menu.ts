import { z } from "zod";

// One schema per route input, shared with the client form. The client copy saves a
// round trip; the SERVER copy is the security control. Never assume the client ran it.
//
// Note what is deliberately ABSENT from every schema here: `restaurantId`. It comes
// from the URL param and is checked by requireMember — never from the request body,
// which is attacker-controlled.

const money = z
  .number({ error: "Enter a price" })
  .nonnegative("Price cannot be negative")
  // Decimal(10,2) — 8 integer digits + 2 decimal. Anything larger is rejected by
  // Postgres with a numeric-overflow error, which would surface as a 500.
  .max(99_999_999.99, "That price is too large")
  .multipleOf(0.01, "At most two decimal places");

/**
 * Images come from Uploadthing and nowhere else.
 *
 * A bare z.url() accepts `javascript:alert(1)`, `data:text/html,…`, `file:///etc/passwd`
 * and `http://169.254.169.254/…` (the cloud metadata endpoint). None of those is a
 * problem while the field is merely stored — they become one the day someone renders
 * `<a href={item.image}>` or points a server-side thumbnailer at it. Pin the scheme now,
 * while the column is empty.
 */
const imageUrl = z.url({ protocol: /^https$/, hostname: /\.ufs\.sh$|\.utfs\.io$/ });

/**
 * THE BASE HAS NO `.default()` ANYWHERE — and that is load-bearing.
 *
 * In Zod 4, `.partial()` does NOT strip a `.default()`: it produces
 * ZodOptional<ZodDefault<…>>, and the default STILL FIRES on a missing key. So a base
 * with `isVeg: z.boolean().default(false)` would mean:
 *
 *     updateSchema.parse({ isAvailable: false })  ->  { isAvailable: false, isVeg: false }
 *
 * i.e. flipping the availability switch on a paneer dish silently rewrites it to
 * NON-VEGETARIAN, and a PATCH that only renames an item resets it to available. The
 * optimistic UI merge doesn't touch isVeg, so the green dot stays green until a refetch
 * — the corruption is invisible at the moment it happens.
 *
 * Defaults belong to the CREATE route, which is the only place a missing field should
 * acquire a value. See the test in tests/unit/validations.test.ts.
 */
const menuItemFields = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80, "That name is too long"),
  description: z.string().trim().max(500, "That description is too long").nullish(),
  price: money,
  // A category is optional (uncategorised items are allowed), but if given it must
  // belong to THIS restaurant — enforced server-side, and by a composite FK in the DB.
  categoryId: z.cuid("Not a valid category").nullish(),
  isAvailable: z.boolean(),
  isVeg: z.boolean(),
  preparationTime: z
    .number()
    .int("Whole minutes only")
    .min(0)
    .max(600, "That is over ten hours")
    .nullish(),
  image: imageUrl.nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const createMenuItemSchema = menuItemFields.extend({
  isAvailable: z.boolean().default(true),
  isVeg: z.boolean().default(false),
});

/** Partial of the DEFAULT-FREE base, so an absent key stays absent. */
export const updateMenuItemSchema = menuItemFields.partial();

const categoryFields = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60, "That name is too long"),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const createCategorySchema = categoryFields;
export const updateCategorySchema = categoryFields.partial();

/** Query params for the item list. */
export const listMenuItemsSchema = z.object({
  categoryId: z.cuid().nullish(),
  search: z.string().trim().max(80).nullish(),
  available: z.enum(["true", "false"]).nullish(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
export type ListMenuItemsInput = z.infer<typeof listMenuItemsSchema>;
