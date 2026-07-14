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
import { Textarea } from "@/components/ui/textarea";
import {
  useCategories,
  useCreateMenuItem,
  useUpdateMenuItem,
  type MenuItem,
} from "@/hooks/use-menu";
import { createMenuItemSchema } from "@/lib/validations/menu";

const NO_CATEGORY = "__none__";

type FieldErrors = Partial<Record<string, string>>;

/**
 * The form is only MOUNTED while the dialog is open, and is keyed by the item it edits.
 *
 * That is what lets its state be plain useState initialisers instead of an effect that
 * copies props into state on open. Syncing with useEffect renders once with the wrong
 * values and then again with the right ones, and it is what the
 * react-hooks/set-state-in-effect rule is warning about. Remounting is both simpler and
 * correct: a fresh item gets a fresh form, and cancelling genuinely discards the edits.
 */
function MenuItemForm({
  restaurantId,
  item,
  onDone,
}: {
  restaurantId: string;
  item?: MenuItem;
  onDone: () => void;
}) {
  const { data: categories } = useCategories(restaurantId);
  const create = useCreateMenuItem(restaurantId);
  const update = useUpdateMenuItem(restaurantId);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? NO_CATEGORY);
  const [isVeg, setIsVeg] = useState(item?.isVeg ?? false);
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true);

  const pending = create.isPending || update.isPending;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = new FormData(event.currentTarget);
    const prep = String(form.get("preparationTime") ?? "").trim();

    // The SAME schema the route uses (src/lib/validations/menu.ts). This copy is for
    // speed, not safety — the server re-validates regardless.
    const parsed = createMenuItemSchema.safeParse({
      name: form.get("name"),
      description: String(form.get("description") ?? "").trim() || null,
      price: Number(form.get("price")),
      categoryId: categoryId === NO_CATEGORY ? null : categoryId,
      isVeg,
      isAvailable,
      preparationTime: prep === "" ? null : Number(prep),
    });

    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".") || "form"] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    if (item) update.mutate({ id: item.id, ...parsed.data }, { onSuccess: onDone });
    else create.mutate(parsed.data, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={item?.name}
          placeholder="Butter Chicken"
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name ? <p className="text-destructive text-sm">{errors.name}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={item?.description ?? ""}
          placeholder="Optional."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="price">Price (₹)</Label>
          <Input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0"
            defaultValue={item?.price}
            placeholder="480"
            aria-invalid={Boolean(errors.price)}
          />
          {errors.price ? <p className="text-destructive text-sm">{errors.price}</p> : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="preparationTime">Prep time (min)</Label>
          <Input
            id="preparationTime"
            name="preparationTime"
            type="number"
            min="0"
            defaultValue={item?.preparationTime ?? ""}
            placeholder="25"
            aria-invalid={Boolean(errors.preparationTime)}
          />
          {errors.preparationTime ? (
            <p className="text-destructive text-sm">{errors.preparationTime}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="category">Category</Label>
        {/* Base UI's Select hands back `string | null` (null = cleared). */}
        <Select
          value={categoryId}
          onValueChange={(value) => setCategoryId(value ?? NO_CATEGORY)}
        >
          <SelectTrigger id="category">
            <SelectValue placeholder="Uncategorised" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CATEGORY}>Uncategorised</SelectItem>
            {categories?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.categoryId ? (
          <p className="text-destructive text-sm">{errors.categoryId}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch id="isVeg" checked={isVeg} onCheckedChange={setIsVeg} />
          <Label htmlFor="isVeg" className="font-normal">
            Vegetarian
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="isAvailable"
            checked={isAvailable}
            onCheckedChange={setIsAvailable}
          />
          <Label htmlFor="isAvailable" className="font-normal">
            Available
          </Label>
        </div>
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

export function MenuItemDialog({
  restaurantId,
  item,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  /** Present = edit, absent = create. */
  item?: MenuItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit item" : "Add item"}</DialogTitle>
          <DialogDescription>
            {item ? `Editing “${item.name}”.` : "A dish on your menu."}
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, keyed by the item — see MenuItemForm. */}
        {open ? (
          <MenuItemForm
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
