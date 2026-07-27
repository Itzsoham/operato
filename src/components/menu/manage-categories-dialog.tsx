"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  type Category,
} from "@/hooks/use-menu";
import { createCategorySchema } from "@/lib/validations/menu";

/**
 * One row per category — a rename field plus a delete button. Kept UNCONTROLLED-ish:
 * `name` resets to `category.name` whenever the row remounts (keyed by id below), so a
 * category renamed elsewhere (or reverted after a failed optimistic update) doesn't leave
 * this input showing a stale draft.
 */
function CategoryRow({ restaurantId, category }: { restaurantId: string; category: Category }) {
  const update = useUpdateCategory(restaurantId);
  const remove = useDeleteCategory(restaurantId);
  const [name, setName] = useState(category.name);

  const trimmed = name.trim();
  const dirty = trimmed !== "" && trimmed !== category.name;

  function onRename(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    update.mutate({ id: category.id, name: trimmed });
  }

  return (
    <form onSubmit={onRename} className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8"
        aria-label={`Rename ${category.name}`}
      />
      <Badge variant="secondary" className="shrink-0">
        {category._count.menuItems} item{category._count.menuItems === 1 ? "" : "s"}
      </Badge>
      <Button type="submit" size="sm" variant="outline" disabled={!dirty || update.isPending}>
        {update.isPending ? "Saving…" : "Save"}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="text-destructive size-8 shrink-0"
        aria-label={`Delete ${category.name}`}
        onClick={() => remove.mutate(category.id)}
        disabled={remove.isPending}
      >
        <Trash2 className="size-4" />
      </Button>
    </form>
  );
}

export function ManageCategoriesDialog({
  restaurantId,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: categories, isPending } = useCategories(restaurantId);
  const create = useCreateCategory(restaurantId);
  const [name, setName] = useState("");

  function onCreate(event: React.FormEvent) {
    event.preventDefault();
    // Same schema the route uses — speed, not safety; the server re-validates regardless.
    const parsed = createCategorySchema.safeParse({ name });
    if (!parsed.success) return;
    create.mutate(parsed.data, { onSuccess: () => setName("") });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage categories</DialogTitle>
          <DialogDescription>
            Group dishes on the menu. A category still holding items can&apos;t be deleted.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <div className="grid gap-4">
            <form onSubmit={onCreate} className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New category"
                className="h-8"
              />
              <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
                {create.isPending ? "Adding…" : "Add"}
              </Button>
            </form>

            <div className="grid max-h-72 gap-2 overflow-y-auto">
              {isPending ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
              ) : categories?.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  No categories yet.
                </p>
              ) : (
                categories?.map((c) => (
                  <CategoryRow key={c.id} restaurantId={restaurantId} category={c} />
                ))
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
