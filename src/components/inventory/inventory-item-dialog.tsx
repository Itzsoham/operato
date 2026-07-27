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
  useCreateInventoryItem,
  useUpdateInventoryItem,
  type StockLine,
} from "@/hooks/use-inventory";
import {
  createInventoryItemSchema,
  updateInventoryItemSchema,
} from "@/lib/validations/inventory";

type FieldErrors = Partial<Record<string, string>>;

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

/**
 * The form is only MOUNTED while the dialog is open, keyed by the item it edits — same
 * reasoning as MenuItemForm: a remount gives a fresh item a fresh form, and cancelling
 * genuinely discards the edits, with no useEffect syncing props into state.
 */
function InventoryItemForm({
  restaurantId,
  item,
  onDone,
}: {
  restaurantId: string;
  /** Present = edit, absent = create. */
  item?: StockLine;
  onDone: () => void;
}) {
  const create = useCreateInventoryItem(restaurantId);
  const update = useUpdateInventoryItem(restaurantId);

  const [errors, setErrors] = useState<FieldErrors>({});
  const pending = create.isPending || update.isPending;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = new FormData(event.currentTarget);
    const cost = String(form.get("costPerUnit") ?? "").trim();
    const supplier = String(form.get("supplier") ?? "").trim();
    const threshold = String(form.get("lowStockThreshold") ?? "").trim();

    const fields = {
      name: form.get("name"),
      unit: form.get("unit"),
      lowStockThreshold: threshold === "" ? undefined : Number(threshold),
      costPerUnit: cost === "" ? null : Number(cost),
      supplier: supplier === "" ? null : supplier,
    };

    // The SAME schemas the routes use (src/lib/validations/inventory.ts). This copy is
    // for speed, not safety — the server re-validates regardless.
    if (item) {
      const parsed = updateInventoryItemSchema.safeParse(fields);
      if (!parsed.success) {
        setErrors(fieldErrorsFrom(parsed.error.issues));
        return;
      }
      update.mutate({ id: item.id, ...parsed.data }, { onSuccess: onDone });
      return;
    }

    const opening = String(form.get("openingStock") ?? "").trim();
    const parsed = createInventoryItemSchema.safeParse({
      ...fields,
      openingStock: opening === "" ? 0 : Number(opening),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error.issues));
      return;
    }
    create.mutate(parsed.data, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            defaultValue={item?.name}
            placeholder="Chicken"
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name ? <p className="text-destructive text-sm">{errors.name}</p> : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="unit">Unit</Label>
          <Input
            id="unit"
            name="unit"
            defaultValue={item?.unit}
            placeholder="kg, litres, pieces…"
            aria-invalid={Boolean(errors.unit)}
          />
          {errors.unit ? <p className="text-destructive text-sm">{errors.unit}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="lowStockThreshold">Reorder below</Label>
          <Input
            id="lowStockThreshold"
            name="lowStockThreshold"
            type="number"
            step="0.001"
            min="0"
            defaultValue={item?.lowStockThreshold ?? 10}
            aria-invalid={Boolean(errors.lowStockThreshold)}
          />
          {errors.lowStockThreshold ? (
            <p className="text-destructive text-sm">{errors.lowStockThreshold}</p>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="costPerUnit">Cost / unit (₹)</Label>
          <Input
            id="costPerUnit"
            name="costPerUnit"
            type="number"
            step="0.01"
            min="0"
            defaultValue={item?.costPerUnit ?? ""}
            placeholder="Optional"
            aria-invalid={Boolean(errors.costPerUnit)}
          />
          {errors.costPerUnit ? (
            <p className="text-destructive text-sm">{errors.costPerUnit}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="supplier">Supplier</Label>
          <Input
            id="supplier"
            name="supplier"
            defaultValue={item?.supplier ?? ""}
            placeholder="Optional"
            aria-invalid={Boolean(errors.supplier)}
          />
          {errors.supplier ? (
            <p className="text-destructive text-sm">{errors.supplier}</p>
          ) : null}
        </div>

        {!item ? (
          <div className="grid gap-2">
            <Label htmlFor="openingStock">Opening stock</Label>
            <Input
              id="openingStock"
              name="openingStock"
              type="number"
              step="0.001"
              min="0"
              defaultValue={0}
              aria-invalid={Boolean(errors.openingStock)}
            />
            {errors.openingStock ? (
              <p className="text-destructive text-sm">{errors.openingStock}</p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Booked as an opening delivery — the ledger accounts for every unit from zero.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : item ? "Save changes" : "Add item"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function InventoryItemDialog({
  restaurantId,
  item,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  /** Present = edit, absent = create. */
  item?: StockLine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit item" : "Add item"}</DialogTitle>
          <DialogDescription>
            {item ? `Editing “${item.name}”.` : "Something tracked in the store."}
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, keyed by the item — see InventoryItemForm. */}
        {open ? (
          <InventoryItemForm
            key={item?.id ?? "new"}
            restaurantId={restaurantId}
            item={item}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
