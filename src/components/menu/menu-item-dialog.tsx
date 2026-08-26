"use client";

import { UtensilsCrossed } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

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
import { useUploadThing } from "@/lib/uploadthing";
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
  const [image, setImage] = useState<string | null>(item?.image ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Menu-item photos, wired to the tenant-scoped `menuItemImage` route in
  // src/app/api/uploadthing/core.ts. The `restaurantId` in `input` is what that route's
  // `.middleware()` verifies against real membership — a plain "signed in" check would
  // let anyone upload "for" a restaurant they don't belong to.
  const { startUpload, isUploading } = useUploadThing("menuItemImage", {
    onClientUploadComplete: (res) => {
      const uploaded = res?.[0]?.ufsUrl;
      if (uploaded) {
        setImage(uploaded);
        toast.success("Photo uploaded");
      }
    },
    onUploadError: (error) => {
      toast.error(error.message || "Photo upload failed");
    },
  });

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the SAME file again still fires a change event.
    event.target.value = "";
    if (!file) return;
    void startUpload([file], { restaurantId });
  }

  // isUploading is part of "pending" deliberately: submitting while a photo upload is still
  // in flight would save the item with whatever `image` happens to be right now (null, or
  // the previous photo) and the upload's own onClientUploadComplete would then call
  // setImage() on a form that's already been unmounted by the dialog closing — the photo
  // the user just picked silently never attaches, with no error to explain why.
  const pending = create.isPending || update.isPending || isUploading;

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
      image,
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
    <form onSubmit={onSubmit} className="grid gap-lg" noValidate>
      <div className="grid gap-xs">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={item?.name}
          placeholder="Butter Chicken"
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name ? <p className="text-small text-destructive">{errors.name}</p> : null}
      </div>

      <div className="grid gap-xs">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={item?.description ?? ""}
          placeholder="Optional."
        />
      </div>

      <div className="grid gap-xs">
        <Label htmlFor="image">Photo</Label>
        <div className="flex items-center gap-sm">
          {image ? (
            // Uploadthing's CDN, not next/image — no remotePatterns are configured for
            // it yet, and a plain <img> is fine for a dialog-sized thumbnail.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              className="size-20 shrink-0 rounded-lg border border-border object-cover shadow-xs"
            />
          ) : (
            // The same DRAWN GROUND the board's cards use: --grad-card-brand plus the
            // utensils glyph, so an item with no photo still looks designed rather than
            // broken, and re-cuts with the palette instead of being a grey square.
            <div className="grid size-20 shrink-0 place-items-center gap-1 rounded-lg border border-border bg-[image:var(--grad-card-brand)] text-brand-subtle-foreground shadow-xs">
              <UtensilsCrossed aria-hidden className="size-6 opacity-60" />
              <span className="text-chip tracking-label uppercase">No photo</span>
            </div>
          )}
          <div className="flex flex-wrap gap-xs">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFileChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? "Uploading…" : image ? "Change photo" : "Upload photo"}
            </Button>
            {image ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setImage(null)}
                disabled={isUploading}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
        {/* Still accepted alongside the upload button — pastes are only useful for
            re-attaching a URL from a PREVIOUS upload, since the schema pins `image` to
            Uploadthing's own hosts (see imageUrl in validations/menu.ts), not any URL. */}
        <Input
          value={image ?? ""}
          onChange={(event) => setImage(event.target.value.trim() || null)}
          placeholder="Or paste an existing photo URL"
          aria-invalid={Boolean(errors.image)}
        />
        {errors.image ? <p className="text-small text-destructive">{errors.image}</p> : null}
      </div>

      <div className="grid gap-sm sm:grid-cols-2">
        <div className="grid gap-xs">
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
          {errors.price ? <p className="text-small text-destructive">{errors.price}</p> : null}
        </div>

        <div className="grid gap-xs">
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
            <p className="text-small text-destructive">{errors.preparationTime}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-xs">
        <Label htmlFor="category">Category</Label>
        {/* Base UI's Select hands back `string | null` (null = cleared), and its
            SelectValue renders the RAW VALUE unless given a render function — which here
            would print the category's cuid at the user. */}
        <Select
          value={categoryId}
          onValueChange={(value) => setCategoryId(value ?? NO_CATEGORY)}
        >
          <SelectTrigger id="category">
            <SelectValue placeholder="Uncategorised">
              {(value) => {
                if (value === NO_CATEGORY) return "Uncategorised";
                // While the categories query is in flight, `find` misses — and falling
                // back to "Uncategorised" would confidently mislabel an item that IS in a
                // category. The item already knows its own category name; use it.
                return (
                  categories?.find((c) => c.id === value)?.name ??
                  item?.category?.name ??
                  "…"
                );
              }}
            </SelectValue>
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
          <p className="text-small text-destructive">{errors.categoryId}</p>
        ) : null}
      </div>

      {/* The two flags become RULED ROWS rather than a loose pair of switches: each is a
          --tap-high control on its own hairline panel, with the consequence spelled out
          underneath. The veg row also carries the statutory mark, so the setting and the
          thing it prints on the board look the same. */}
      <div className="grid gap-xs sm:grid-cols-2">
        <div className="flex min-h-tap items-center gap-sm rounded-lg border border-border bg-muted/40 px-card-sm py-2">
          {/* The FSSAI form: a square OUTLINE carrying a filled CIRCLE for veg and a
              filled TRIANGLE for non-veg. The GLYPH is what separates the two states —
              the hues are only 5.90–10.47 dE apart under deuteranopia, so a dot in both
              states (what this drew) was status by colour alone. Still aria-hidden: the
              Switch beside it is the labelled control and already announces the state,
              so this is a live preview of the mark, not a second announcement. The two
              hues are fixed by law and are the one pair that must not re-theme. */}
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className={`size-3.5 shrink-0 ${isVeg ? "text-veg" : "text-nonveg"}`}
          >
            <rect
              x="2.3"
              y="2.3"
              width="19.4"
              height="19.4"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
            />
            {isVeg ? (
              <circle cx="12" cy="12" r="5.1" fill="currentColor" />
            ) : (
              <path d="M12 6.4 17.4 16.4 6.6 16.4Z" fill="currentColor" />
            )}
          </svg>
          <Label htmlFor="isVeg" className="flex-1 font-normal">
            Vegetarian
          </Label>
          <Switch id="isVeg" checked={isVeg} onCheckedChange={setIsVeg} />
        </div>

        <div className="flex min-h-tap items-center gap-sm rounded-lg border border-border bg-muted/40 px-card-sm py-2">
          <Label htmlFor="isAvailable" className="flex-1 font-normal">
            Available
          </Label>
          <Switch
            id="isAvailable"
            checked={isAvailable}
            onCheckedChange={setIsAvailable}
          />
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
