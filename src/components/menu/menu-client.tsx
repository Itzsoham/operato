"use client";

import {
  AlertTriangle,
  ChefHat,
  ListTree,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { useDeferredValue, useState } from "react";

import { ManageCategoriesDialog } from "@/components/menu/manage-categories-dialog";
import { MenuItemDialog } from "@/components/menu/menu-item-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useDeleteMenuItem,
  useMenuItems,
  useUpdateMenuItem,
  type MenuItem,
} from "@/hooks/use-menu";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * THE STAGGERED ENTRANCE. `animate-rise` carries the keyframe, duration and easing from
 * the --animate-rise token; the delay is the half a Tailwind animation shorthand cannot
 * hold, so it is spelled out off --i and --stagger (the cadence is per palette).
 * prefers-reduced-motion zeroes both in globals.css.
 */
const rise = (i: number) =>
  ({ "--i": i, animationDelay: "calc(var(--i) * var(--stagger))" }) as React.CSSProperties;

/**
 * THE FSSAI MARK — a square outline carrying a filled CIRCLE (veg) or a filled
 * TRIANGLE (non-veg), per the Indian labelling rule.
 *
 * THE INNER GLYPH IS THE WHOLE POINT, and it used to be wrong. This drew a circle for
 * BOTH states and let --veg/--nonveg carry the difference alone. That is the one
 * encoding a green/maroon pair must never rely on: measured across the eight
 * palette/mode blocks, veg vs nonveg is only dE2000 5.90–10.47 apart under simulated
 * deuteranopia — the two marks are effectively the same colour to a red-green
 * dichromat, which is 8% of men. The comment above this function used to claim the
 * mark "reads in greyscale"; with one shape it did not, in any theme.
 *
 * The 2011 Food Safety and Standards (Packaging & Labelling) rules — and the 2022
 * amendment that sharpened them — specify the two glyphs as a circle and a triangle
 * precisely so the mark survives monochrome print. Drawing the statutory form is
 * therefore both the legal answer and the accessible one, and it fixes all eight
 * themes at once WITHOUT touching a colour: shape now carries the status, and colour
 * is the redundant second channel rather than the only one.
 *
 * The two colours (--veg, --nonveg) stay green/maroon in every palette and are the one
 * pair in the system that must NOT re-theme.
 */
function FssaiMark({ isVeg }: { isVeg: boolean }) {
  const label = isVeg ? "Vegetarian" : "Non-vegetarian";
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
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
        /* Equilateral, apex up, centred on the same optical centre as the veg dot and
           area-matched to it so neither mark reads as the heavier of the two. */
        <path d="M12 6.4 17.4 16.4 6.6 16.4Z" fill="currentColor" />
      )}
    </svg>
  );
}

/**
 * THE PLATE — the dish "photograph".
 *
 * Most tenants have no photos, and a grid of grey boxes is worse than no grid. So the
 * placeholder is a DRAWN GROUND rather than an absence: --grad-card-brand (the palette's
 * own brand-subtle wash falling to --card) with the utensils glyph floated in it. Crema
 * gets warm caramel paper, Forno a semolina dust, Lievito flat stock, Saffron a
 * candlelit panel — one element, four directions, and not one literal colour.
 */
function Plate({ item }: { item: MenuItem }) {
  return (
    <div className="relative aspect-16/10 w-full overflow-hidden border-b border-border bg-[image:var(--grad-card-brand)]">
      {item.image ? (
        // Uploadthing's CDN, not next/image — no remotePatterns are configured for it,
        // and the card thumbnail is small enough that the optimiser would earn nothing.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
        />
      ) : (
        <UtensilsCrossed
          aria-hidden
          className="absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 text-brand-subtle-foreground opacity-40"
        />
      )}

      {/* The statutory mark rides the plate, on its own ceramic tile so it never has to
          clear an unknown photograph. */}
      <span className="absolute top-2 left-2 z-1 grid size-6 place-items-center rounded-xs bg-card shadow-xs ring-1 ring-border">
        <FssaiMark isVeg={item.isVeg} />
      </span>

      {/* OFF THE BOARD is a WORD, not a dimming. The card also goes quiet underneath, but
          the badge is the statement — an item pulled from service must never be signalled
          by opacity, which reads as "loading" to everyone and as nothing at all in
          greyscale. */}
      {!item.isAvailable ? (
        <Badge variant="secondary" className="absolute bottom-2 left-2 z-1 shadow-xs">
          Off the board
        </Badge>
      ) : null}
    </div>
  );
}

/** One skeleton dish, shaped like the card it stands in for — not a bare grey bar. */
function DishSkeleton({ index }: { index: number }) {
  return (
    <div
      className="animate-rise flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      style={rise(index)}
      aria-hidden
    >
      <Skeleton className="aspect-16/10 w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-xs p-card-sm">
        <div className="flex items-center gap-xs">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-6 w-16" />
        </div>
        <Skeleton className="h-3 w-2/3" />
        <div className="mt-sm flex items-center gap-xs border-t border-border pt-sm">
          <Skeleton className="h-6 w-11.5 rounded-md" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}

export function MenuClient({ restaurantId }: { restaurantId: string }) {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | undefined>();
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  // The SERVER does the filtering, and the filter is part of the query key. Filtering
  // client-side would have meant the whole menu is always fetched — fine for 17 dishes,
  // wrong for the thousands of orders the next module lists. useDeferredValue keeps the
  // input responsive without firing a request per keystroke.
  const deferredSearch = useDeferredValue(search.trim());
  const filters = deferredSearch ? { search: deferredSearch } : undefined;

  const { data: items, isPending, isError, error } = useMenuItems(restaurantId, filters);
  const update = useUpdateMenuItem(restaurantId);
  const remove = useDeleteMenuItem(restaurantId);

  const visible = items;

  function openCreate() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(item: MenuItem) {
    setEditing(item);
    setDialogOpen(true);
  }

  // THE ERROR STATE, in the system: the destructive -subtle triple (opaque wash, text
  // measured >=5.5:1 on it, decorative opaque edge) rather than a red sentence on the
  // page ground. It still prints the server's own message — an error state that hides
  // what went wrong is decoration.
  if (isError) {
    return (
      <div className="p-page">
        <Card className="animate-rise border-destructive-border bg-destructive-subtle" style={rise(0)}>
          <CardContent className="flex flex-wrap items-start gap-sm">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-md bg-card text-destructive-subtle-foreground shadow-xs ring-1 ring-destructive-border"
            >
              <AlertTriangle className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-h2 text-foreground">
                Couldn&apos;t load the menu
              </h2>
              <p className="mt-1 max-w-measure text-small text-destructive-subtle-foreground">
                {error.message}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-lg p-page">
      {/* THE TOOLBAR — one strip above the board (crema-menu.html §9): search hard left,
          the count, then the two actions hard right. */}
      <div
        className="animate-rise flex flex-wrap items-center gap-sm rounded-2xl border border-border bg-card p-card-sm shadow-xs"
        style={rise(0)}
      >
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dishes…"
            aria-label="Search dishes"
            className="pl-10"
          />
        </div>

        {!isPending && visible ? (
          <span className="text-label tracking-label tabular-nums text-muted-foreground uppercase">
            {visible.length} dish{visible.length === 1 ? "" : "es"}
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-xs">
          <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
            <ListTree className="size-4" />
            Manage categories
          </Button>
          {/* The one coloured cast the system allows per screen: shadow-brand on the
              primary CTA, and nothing else. */}
          <Button className="shadow-brand" onClick={openCreate}>
            <Plus className="size-4" />
            Add item
          </Button>
        </div>
      </div>

      {isPending ? (
        <div
          className="grid gap sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          aria-busy="true"
          aria-label="Loading dishes"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <DishSkeleton key={i} index={i} />
          ))}
        </div>
      ) : visible?.length === 0 ? (
        // THE EMPTY STATE — a dashed well with a brand-subtle tile, a display-face line,
        // and the one action that resolves it. Two different emptinesses, two different
        // sentences: "nothing matched" is not "nothing exists".
        <div
          className="animate-rise flex flex-col items-center gap-sm rounded-2xl border border-dashed border-border bg-muted/40 px-card py-16 text-center"
          style={rise(1)}
        >
          <span
            aria-hidden
            className="grid size-14 place-items-center rounded-xl bg-brand-subtle text-brand-subtle-foreground shadow-xs"
          >
            <ChefHat className="size-6" />
          </span>
          <p className="font-heading text-h2 text-foreground">
            {search ? "No dishes match that search" : "The board is empty"}
          </p>
          <p className="max-w-measure text-small text-balance text-muted-foreground">
            {search
              ? "Try a shorter word, or clear the search to see the whole board."
              : "Add your dishes once and every order screen, every report and the AI assistant read from the same list."}
          </p>
          {!search ? (
            <Button variant="outline" onClick={openCreate}>
              <Plus className="size-4" />
              Add the first one
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visible?.map((item, i) => (
            <li key={item.id} className="animate-rise" style={rise(i)}>
              {/* THE DISH CARD (crema-menu.html §12). Off the board is QUIETER, never
                  dimmer — the surface drops to --muted and the edge firms up, but the
                  type stays at full ink so a pulled dish is still readable at a glance. */}
              <article
                data-available={item.isAvailable}
                className="group/dish flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-[box-shadow,border-color,background-color] duration-(--dur) ease-quint hover:border-input hover:shadow data-[available=false]:border-input data-[available=false]:bg-muted data-[available=false]:shadow-none"
              >
                <Plate item={item} />

                <div className="flex flex-1 flex-col gap-xs p-card-sm">
                  <div className="flex items-start gap-sm">
                    <h3 className="min-w-0 flex-1 text-body font-semibold text-foreground">
                      {item.name}
                    </h3>
                    {/* Money in the numeric face at the metric step, tabular so a column
                        of cards lines its rupees up down the grid. */}
                    <span className="shrink-0 font-num text-metric tabular-nums text-foreground">
                      {inr.format(item.price)}
                    </span>
                  </div>

                  {item.category ? (
                    <div>
                      <Badge variant="secondary">{item.category.name}</Badge>
                    </div>
                  ) : null}

                  <p className="line-clamp-2 min-h-9 text-small text-muted-foreground">
                    {item.description ?? "No description yet."}
                  </p>

                  <div className="mt-auto flex items-center gap-xs border-t border-border pt-sm">
                    <Switch
                      checked={item.isAvailable}
                      aria-label={`${item.name} available`}
                      // Optimistic — see useUpdateMenuItem. The toggle flips instantly and
                      // rolls back if the server refuses.
                      onCheckedChange={(isAvailable) =>
                        update.mutate({ id: item.id, isAvailable })
                      }
                    />
                    <span aria-hidden className="min-w-0 flex-1 truncate text-small text-muted-foreground">
                      {item.isAvailable ? "On the board" : "Off the board"}
                    </span>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${item.name}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(item)}>
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => remove.mutate(item.id)}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <MenuItemDialog
        restaurantId={restaurantId}
        item={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <ManageCategoriesDialog
        restaurantId={restaurantId}
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
      />
    </div>
  );
}
