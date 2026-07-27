import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type {
  ClockInInput,
  ClockOutInput,
  CreateStaffInput,
  UpdateStaffInput,
} from "@/lib/validations/staff";

/** See src/lib/orders/service.ts — the database must give up before the platform does. */
export const TX_OPTIONS = { maxWait: 8_000, timeout: 12_000 } as const;

export class StaffError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "StaffError";
  }
}

const D = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value);

/**
 * The roster. Filterable by `isActive` so a client can show "current staff" by default
 * without hiding people who left — their Shift history (payroll, hours) must stay
 * reachable, which is the whole reason deactivation exists instead of a real delete.
 */
export async function listStaff(restaurantId: string, activeOnly?: boolean) {
  return prisma.staff.findMany({
    where: {
      restaurantId,
      ...(activeOnly === undefined ? {} : { isActive: activeOnly }),
    },
    orderBy: { name: "asc" },
  });
}

export async function createStaff(restaurantId: string, input: CreateStaffInput) {
  return prisma.staff.create({
    data: {
      restaurantId, // from the URL, never the body
      name: input.name,
      role: input.role,
      email: input.email ?? null,
      phone: input.phone ?? null,
      // A passthrough literal, not an arithmetic result — same shape as
      // InventoryItem.costPerUnit in createInventoryItem. Prisma converts the JS number
      // to NUMERIC precisely; the float-precision risk this codebase guards against is in
      // doing ARITHMETIC with floats (see the hoursWorked computation in clockOut below),
      // not in storing a caller-supplied literal.
      salary: input.salary ?? null,
      isActive: input.isActive,
    },
  });
}

/**
 * Edits a staff member's DETAILS — including `isActive`, so this doubles as the
 * reactivation path (flip it back to true). It does NOT touch shift history: hours and
 * clock times only ever move through clockIn/clockOut, below.
 */
export async function updateStaff(restaurantId: string, staffId: string, input: UpdateStaffInput) {
  return prisma.staff.update({
    where: { id_restaurantId: { id: staffId, restaurantId } },
    data: input,
  });
}

/**
 * Soft-delete. A hard `prisma.staff.delete` would CASCADE away every `Shift` the person
 * ever worked (`Shift.staff` is `onDelete: Cascade`) — silently erasing the attendance
 * and hours-worked history that payroll and the AI report on, with no trace it ever
 * existed. That is worse than what Menu/Inventory's own DELETE routes guard against (a
 * dish that has ever been ordered, or an item with stock still on the shelf, simply
 * REFUSES to delete — see menu/items/[itemId] and inventory/[itemId]): there the refusal
 * PRESERVES the record; a cascading delete here would not even leave that option.
 * `isActive: false` is the same "make unavailable, keep the history" move this codebase
 * already uses for a dish (`isAvailable`).
 *
 * Deliberately does NOT touch an open shift, if one exists. Auto-clocking someone out as
 * a side effect of deactivating them would write a `Shift.endTime` nobody actually
 * observed — fabricating an attendance record, which is the opposite of what an audit
 * trail is for. Close the open shift explicitly first if that matters.
 */
export async function deactivateStaff(restaurantId: string, staffId: string) {
  return prisma.staff.update({
    where: { id_restaurantId: { id: staffId, restaurantId } },
    data: { isActive: false },
  });
}

/**
 * Clocks a staff member in.
 *
 * THE RACE: two clock-ins for the same person land at once (a double-tap on a shared
 * terminal, or a retried request). Both read "no open shift" and both insert one, and
 * now the roster shows one person on two simultaneous shifts with no way to tell which
 * `Shift` is real. `SELECT ... FOR UPDATE` on the STAFF row is the serialisation point —
 * the same shape as locking the table row before seating an order (see
 * src/lib/orders/service.ts): the second transaction blocks here and, once it can
 * proceed, sees the first's committed shift and refuses.
 */
export async function clockIn(restaurantId: string, staffId: string, input: ClockInInput) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; name: string; isActive: boolean }[]>`
      SELECT id, name, "isActive" FROM "Staff"
       WHERE id = ${staffId} AND "restaurantId" = ${restaurantId}
       FOR UPDATE`;

    const staff = rows[0];
    if (!staff) throw new StaffError(404, "No such staff member.");
    if (!staff.isActive) {
      throw new StaffError(409, `${staff.name} isn't active — reactivate them first.`);
    }

    const open = await tx.shift.findFirst({
      where: { staffId, restaurantId, endTime: null },
      select: { id: true },
    });
    if (open) throw new StaffError(409, `${staff.name} is already clocked in.`);

    const startTime = input.startTime ?? new Date();
    // A minute's grace for clock skew between the client and the server; beyond that,
    // "clocked in" for a shift that hasn't happened yet is nonsense no report can recover
    // from.
    if (startTime.getTime() > Date.now() + 60_000) {
      throw new StaffError(400, "Clock-in time can't be in the future.");
    }

    return tx.shift.create({
      data: {
        staffId,
        restaurantId, // denormalised — also pinned by the composite FK to Staff(id, restaurantId)
        startTime,
        notes: input.notes ?? null,
      },
    });
  }, TX_OPTIONS);
}

/**
 * Clocks a shift out: sets `endTime` and computes `hoursWorked`.
 *
 * The duration is computed with `Prisma.Decimal`, not left as a raw JS number from
 * `ms / 3_600_000` — that IS an arithmetic result headed straight for a `Decimal(5,2)`
 * column, exactly the case the codebase's "money and hours are Decimal, never float"
 * rule is about (unlike `salary`/`costPerUnit`-style passthroughs above, which store a
 * literal the caller supplied and do no arithmetic on it).
 *
 * `SELECT ... FOR UPDATE` on the SHIFT row both locks out a concurrent double-clock-out
 * of the same shift and is where "already clocked out" gets checked against a value that
 * cannot change under us mid-transaction.
 */
export async function clockOut(restaurantId: string, shiftId: string, input: ClockOutInput) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; startTime: Date; endTime: Date | null }[]>`
      SELECT id, "startTime", "endTime" FROM "Shift"
       WHERE id = ${shiftId} AND "restaurantId" = ${restaurantId}
       FOR UPDATE`;

    const shift = rows[0];
    if (!shift) throw new StaffError(404, "No such shift.");
    if (shift.endTime) throw new StaffError(409, "This shift has already been clocked out.");

    const endTime = input.endTime ?? new Date();
    if (endTime.getTime() <= shift.startTime.getTime()) {
      throw new StaffError(400, "Clock-out time must be after clock-in time.");
    }

    const hoursWorked =
      input.hoursWorked !== undefined
        ? D(input.hoursWorked)
        : D(endTime.getTime() - shift.startTime.getTime())
            .div(3_600_000)
            .toDecimalPlaces(2);

    // Decimal(5,2) tops out at 999.99. Nothing legitimate gets near it, but a bad
    // backdated `startTime` could — refuse before Postgres answers with a raw
    // numeric-overflow (22003). Same shape as the balance-overflow guard in
    // src/lib/inventory/service.ts.
    if (hoursWorked.greaterThan("999.99")) {
      throw new StaffError(422, "That shift is longer than we can record — check the times.");
    }

    // updateMany, not update: unlike InventoryItem/MenuItem/Customer/Staff itself, `Shift`
    // has no `@@unique([id, restaurantId])` to key a single tenant-scoped statement on.
    // The row is already locked and tenant-verified above, in the SAME transaction — this
    // is defense in depth, not the only check standing between tenants.
    await tx.shift.updateMany({
      where: { id: shiftId, restaurantId },
      data: { endTime, hoursWorked },
    });

    return tx.shift.findUniqueOrThrow({ where: { id: shiftId } });
  }, TX_OPTIONS);
}
