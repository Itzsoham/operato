"use client";

import { FolderPlus, Trash2 } from "lucide-react";
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
 * THE STAGGERED ENTRANCE. `animate-rise` carries the keyframe from the --animate-rise
 * token; --i and --stagger carry the delay a Tailwind animation shorthand cannot hold.
 */
const rise = (i: number) =>
  ({ "--i": i, animationDelay: "calc(var(--i) * var(--stagger))" }) as React.CSSProperties;

/**
 * One row per category — a rename field plus a delete button. Kept UNCONTROLLED-ish:
 * `name` resets to `category.name` whenever the row remounts (keyed by id below), so a
 * category renamed elsewhere (or reverted after a failed optimistic update) doesn't leave
 * this input showing a stale draft.
 *
 * The row is a RULED PANEL rather than three loose controls in a line: a hairline edge,
 * the card surface, --pad-card-sm of air. Every control on it sits at --tap-sm, the
 * desktop chrome floor, so the row height is a token rather than an h-8 guess.
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
    <form
      onSubmit={onRename}
      className="flex flex-wrap items-center gap-xs rounded-lg border border-border bg-card px-2 py-1.5 shadow-xs transition-colors duration-(--dur) ease-quint hover:border-input"
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-tap-sm min-w-0 flex-1 text-small"
        aria-label={`Rename ${category.name}`}
      />
      <Badge variant="secondary" className="shrink-0 tabular-nums">
        {category._count.menuItems} item{category._count.menuItems === 1 ? "" : "s"}
      </Badge>
      <Button type="submit" size="sm" variant="outline" disabled={!dirty || update.isPending}>
        {update.isPending ? "Saving…" : "Save"}
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="shrink-0 text-destructive"
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
          <div className="grid gap-sm">
            <form onSubmit={onCreate} className="flex items-center gap-xs">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New category"
                aria-label="New category name"
                className="h-tap-sm text-small"
              />
              <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
                {create.isPending ? "Adding…" : "Add"}
              </Button>
            </form>

            <div className="grid max-h-80 gap-xs overflow-y-auto">
              {isPending ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="animate-rise h-13 w-full rounded-lg"
                    style={rise(i)}
                    aria-hidden
                  />
                ))
              ) : categories?.length === 0 ? (
                // THE EMPTY STATE, in the system: a dashed well, a brand-subtle tile, and
                // a sentence that says what a category is FOR rather than that there are
                // none.
                <div
                  className="animate-rise flex flex-col items-center gap-xs rounded-xl border border-dashed border-border bg-muted/40 px-card-sm py-8 text-center"
                  style={rise(0)}
                >
                  <span
                    aria-hidden
                    className="grid size-11 place-items-center rounded-lg bg-brand-subtle text-brand-subtle-foreground shadow-xs"
                  >
                    <FolderPlus className="size-5" />
                  </span>
                  <p className="text-body font-semibold text-foreground">No categories yet</p>
                  <p className="max-w-measure text-small text-balance text-muted-foreground">
                    Starters, Breads, Mains — the sections dishes get grouped under on the
                    board and on every order screen.
                  </p>
                </div>
              ) : (
                categories?.map((c, i) => (
                  <div key={c.id} className="animate-rise" style={rise(i)}>
                    <CategoryRow restaurantId={restaurantId} category={c} />
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
