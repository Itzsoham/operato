import { z } from "zod";

import { StaffRole } from "@/generated/prisma/enums";

// NO `.default()` on any base that later gets `.partial()`d — Zod 4's `.partial()` does
// NOT strip a default, so a PATCH of one field would silently rewrite the others (it
// already flipped a boolean in the Menu module once; see tests/unit/validations.test.ts
// and the same note in inventory.ts / menu.ts / orders.ts). Defaults belong to the
// CREATE schema only.

const salary = z
  .number()
  .nonnegative("Cannot be negative")
  // Decimal(10,2) — 8 integer digits + 2 decimal. Anything larger overflows Postgres and
  // would surface as a 500.
  .max(99_999_999.99, "That's too large")
  .multipleOf(0.01, "At most two decimal places");

const phone = z
  .string()
  .trim()
  .min(6, "That doesn't look like a phone number")
  .max(20, "That's too long")
  .regex(/^[+\d][\d\s()-]*$/, "Digits, spaces, + and - only");

const staffFields = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80, "That name is too long"),
  role: z.enum(StaffRole, { error: "Choose a role" }),
  email: z.email("Not a valid email").trim().max(120).nullish(),
  phone: phone.nullish(),
  salary: salary.nullish(),
  isActive: z.boolean(),
});

export const createStaffSchema = staffFields.extend({
  isActive: z.boolean().default(true),
});

/** Partial of the DEFAULT-FREE base, so an absent key stays absent. */
export const updateStaffSchema = staffFields.partial();

export const listStaffSchema = z.object({
  active: z.enum(["true", "false"]).nullish(),
});

// ── shifts ───────────────────────────────────────────────────────────────────

/**
 * Clocking in.
 *
 * `startTime` is OPTIONAL and defaults to "now" in the service — the common case is a
 * shift starting right this second. It can be supplied to backdate a shift a manager is
 * logging after the fact (someone forgot to clock in); the service still refuses a
 * start time in the future.
 */
export const clockInSchema = z.object({
  startTime: z.coerce.date().optional(),
  notes: z.string().trim().max(200).nullish(),
});

/**
 * Clocking out.
 *
 * `hoursWorked` can be supplied to override the computed duration (a manager correcting
 * an unpaid-break gap, say); if omitted the service computes it from
 * `endTime - startTime`. Either way it is stored as `Prisma.Decimal`, never a raw float
 * — see src/lib/staff/service.ts.
 */
export const clockOutSchema = z.object({
  endTime: z.coerce.date().optional(),
  hoursWorked: z
    .number()
    .nonnegative("Cannot be negative")
    // Decimal(5,2) on the column — 3 integer digits + 2 decimal, so a single shift tops
    // out at 999.99 hours. No real shift gets near that; this just keeps the same
    // "reject before Postgres does" shape as the other Decimal fields.
    .max(999.99, "That's too many hours for one shift")
    .multipleOf(0.01, "At most two decimal places")
    .optional(),
});

export const listShiftsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type ClockInInput = z.infer<typeof clockInSchema>;
export type ClockOutInput = z.infer<typeof clockOutSchema>;
