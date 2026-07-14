import { z } from "zod";

import { OrderStatus, OrderType, TableStatus } from "@/generated/prisma/enums";

// NOTE the shape of every schema below: NO `.default()` on any base that later gets
// `.partial()`d. Zod 4's `.partial()` does NOT strip a default — it still fires on a
// missing key, so a PATCH of one field silently rewrites the others. That bug shipped in
// the Menu module (it flipped vegetarian dishes to non-vegetarian) and is covered by
// tests/unit/validations.test.ts. Defaults belong to the CREATE schema only.

// ── tables ───────────────────────────────────────────────────────────────────

const tableFields = z.object({
  number: z.number().int().min(1, "Table number starts at 1").max(999),
  label: z.string().trim().max(40).nullish(),
  capacity: z.number().int().min(1).max(50),
});

export const createTableSchema = tableFields.extend({
  capacity: z.number().int().min(1).max(50).default(4),
});

/** The floor plan: a table's number, name and size. NOT its status — see below. */
export const updateTableSchema = tableFields.partial();

/**
 * Table status is DERIVED state — "is a live order sitting here?" — and the order service
 * maintains it under a row lock. Letting it be PATCHed alongside the floor plan made it a
 * fourth, unlocked writer, able to mark a table free with a live order on it.
 *
 * So status moves through its own endpoint, and only between the states a HUMAN decides.
 * OCCUPIED is not one of them: that is the consequence of an order existing, never a
 * thing anyone sets by hand.
 */
export const setTableStatusSchema = z.object({
  status: z.enum([TableStatus.AVAILABLE, TableStatus.RESERVED, TableStatus.INACTIVE]),
});

// ── orders ───────────────────────────────────────────────────────────────────

/**
 * A line as the CLIENT sends it: what, and how many.
 *
 * Deliberately no price. The client does not get to say what a dish costs — the server
 * reads the price from the menu at the moment the order is placed. Trusting a
 * body-supplied `unitPrice` is how a customer orders a ₹480 curry for ₹1.
 */
export const orderLineSchema = z.object({
  menuItemId: z.cuid("Not a valid menu item"),
  quantity: z.number().int().min(1, "At least one").max(99, "That is a lot"),
  notes: z.string().trim().max(200).nullish(),
});

export const createOrderSchema = z.object({
  type: z.enum(OrderType).default(OrderType.DINE_IN),
  tableId: z.cuid().nullish(),
  customerId: z.cuid().nullish(),
  notes: z.string().trim().max(500).nullish(),
  // Money the staff CAN set: a discount is a decision, not a calculation.
  discount: z
    .number()
    .nonnegative("A discount cannot be negative")
    .max(99_999_999.99)
    .multipleOf(0.01, "At most two decimal places")
    .default(0),
  items: z.array(orderLineSchema).min(1, "An order needs at least one item"),
});

/**
 * Status changes only. Everything else about a placed order is immutable through this
 * route — the totals were computed by the server and must not be editable by a PATCH.
 */
export const updateOrderStatusSchema = z.object({
  status: z.enum(OrderStatus),
});

export const listOrdersSchema = z.object({
  status: z.enum(OrderStatus).nullish(),
  /** "open" = anything not yet PAID or CANCELLED — the kitchen's working set. */
  open: z.enum(["true", "false"]).nullish(),
  search: z.string().trim().max(80).nullish(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateTableInput = z.infer<typeof createTableSchema>;
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderLineInput = z.infer<typeof orderLineSchema>;

/**
 * Which status can follow which.
 *
 * Without this, a PATCH can walk an order backwards from PAID to PENDING — un-taking a
 * payment that already rolled up into the customer's lifetime spend, leaving the books
 * and the CRM disagreeing with each other and no record of why.
 *
 * PAID and CANCELLED are terminal. Cancelling is allowed from anything unpaid: a table
 * can walk out at any point before they settle.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]: [OrderStatus.SERVED, OrderStatus.CANCELLED],
  [OrderStatus.SERVED]: [OrderStatus.CANCELLED], // to PAID only via the /pay route
  [OrderStatus.PAID]: [],
  [OrderStatus.CANCELLED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
