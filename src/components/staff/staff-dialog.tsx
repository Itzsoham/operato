"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { StaffRole } from "@/generated/prisma/enums";
import { useCreateStaff, useUpdateStaff, type Staff } from "@/hooks/use-staff";
import { createStaffSchema } from "@/lib/validations/staff";

export const ROLE_LABEL: Record<StaffRole, string> = {
  CHEF: "Chef",
  SOUS_CHEF: "Sous Chef",
  WAITER: "Waiter",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  DELIVERY: "Delivery",
  HELPER: "Helper",
};

type FieldErrors = Partial<Record<string, string>>;

export function StaffDialog({
  restaurantId,
  staff,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  /** Present = edit an existing staff member. Absent = hire someone new. */
  staff?: Staff;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{staff ? staff.name : "Add staff"}</DialogTitle>
          <DialogDescription>
            {staff ? ROLE_LABEL[staff.role] : "A new member of the team."}
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <StaffForm
            key={staff?.id ?? "new"}
            restaurantId={restaurantId}
            staff={staff}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The form is only MOUNTED while the dialog is open, keyed by the staff member it edits —
 * same reasoning as MenuItemForm/InventoryItemForm: a remount gives a fresh hire a fresh
 * form, and cancelling genuinely discards the edits, with no useEffect syncing props into
 * state.
 *
 * Unlike CustomerForm, there is no separate detail fetch here: the roster list endpoint
 * already returns every field (email, phone, salary) for every row — nothing here is
 * withheld the way Customer's list withholds email.
 */
function StaffForm({
  restaurantId,
  staff,
  onDone,
}: {
  restaurantId: string;
  staff?: Staff;
  onDone: () => void;
}) {
  const create = useCreateStaff(restaurantId);
  const update = useUpdateStaff(restaurantId);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [role, setRole] = useState<StaffRole>(staff?.role ?? "WAITER");
  const [isActive, setIsActive] = useState(staff?.isActive ?? true);

  const pending = create.isPending || update.isPending;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const salary = String(form.get("salary") ?? "").trim();

    // The SAME schema the route uses (src/lib/validations/staff.ts). This copy is for
    // speed, not safety — the server re-validates regardless. `role` and `isActive` come
    // from controlled state, not FormData — the Select and Switch primitives here don't
    // participate in native form submission, the same reason MenuItemForm's category
    // Select and isVeg/isAvailable Switches are read from state.
    const parsed = createStaffSchema.safeParse({
      name: form.get("name"),
      role,
      email: email === "" ? null : email,
      phone: phone === "" ? null : phone,
      salary: salary === "" ? null : Number(salary),
      isActive,
    });

    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".") || "form"] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    if (staff) update.mutate({ id: staff.id, ...parsed.data }, { onSuccess: onDone });
    else create.mutate(parsed.data, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={staff?.name}
          placeholder="Priya Sharma"
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name ? <p className="text-destructive text-sm">{errors.name}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="role">Role</Label>
        <Select value={role} onValueChange={(value) => setRole((value ?? "WAITER") as StaffRole)}>
          <SelectTrigger id="role" className="w-full">
            <SelectValue>{(value) => ROLE_LABEL[value as StaffRole]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROLE_LABEL) as StaffRole[]).map((key) => (
              <SelectItem key={key} value={key}>
                {ROLE_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.role ? <p className="text-destructive text-sm">{errors.role}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={staff?.phone ?? ""}
            placeholder="Optional"
            aria-invalid={Boolean(errors.phone)}
          />
          {errors.phone ? <p className="text-destructive text-sm">{errors.phone}</p> : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={staff?.email ?? ""}
            placeholder="Optional"
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? <p className="text-destructive text-sm">{errors.email}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="salary">Salary (per month)</Label>
          <Input
            id="salary"
            name="salary"
            type="number"
            step="0.01"
            min="0"
            defaultValue={staff?.salary ?? ""}
            placeholder="Optional"
            aria-invalid={Boolean(errors.salary)}
          />
          {errors.salary ? <p className="text-destructive text-sm">{errors.salary}</p> : null}
        </div>

        <div className="flex items-center gap-2 pb-2 pt-6">
          <Switch id="isActive" checked={isActive} onCheckedChange={setIsActive} />
          <Label htmlFor="isActive" className="font-normal">
            Active
          </Label>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : staff ? "Save changes" : "Add staff"}
        </Button>
      </DialogFooter>
    </form>
  );
}

