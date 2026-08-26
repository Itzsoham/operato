"use client";

import {
  AlertTriangle,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { InventoryItemDialog } from "@/components/inventory/inventory-item-dialog";
import { MovementDialog } from "@/components/inventory/movement-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useDeleteInventoryItem,
  useInventoryAlert,
  useStock,
  type StockLine,
} from "@/hooks/use-inventory";
import { cn } from "@/lib/utils";

/**
 * How full the shelf is, drawn against TWICE the reorder line — so the tick at the
 * halfway mark IS the reorder line and a bar under it is, literally, under the line.
 *
 * The bar is never the only signal: the figure is printed beside it, the row carries
 * a "reorder" word-badge, and the fill steps from success to warning. Colour alone
 * would fail the one person on the shift who cannot see the difference.
 */
function StockMeter({ item }: { item: StockLine }) {
  const span = Math.max(item.lowStockThreshold * 2, 1);
  const pct = Math.max(0, Math.min(100, (item.currentStock / span) * 100));

  return (
    <span
      aria-hidden
      className="relative block h-1.5 w-24 overflow-hidden rounded-pill bg-muted"
    >
      <span
        className={cn(
          "block h-full rounded-pill transition-[width] duration-(--dur-lg) ease-quint",
          item.needsReorder ? "bg-warning" : "bg-success",
        )}
        style={{ width: `${pct}%` }}
      />
      {/* The reorder line itself — a hairline standing on the track at 50%. */}
      <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/45" />
    </span>
  );
}

export function InventoryClient({
  restaurantId,
  canAdjust,
}: {
  restaurantId: string;
  /** A stock-take is the only unbounded write to the balance — managers only. */
  canAdjust: boolean;
}) {
  const { data: stock, isPending, isError, error } = useStock(restaurantId);
  const remove = useDeleteInventoryItem(restaurantId);
  // Explicit action only — never fired on mount. See the hook's own comment for why.
  const alert = useInventoryAlert(restaurantId);

  // Hold the ID and DERIVE the item from the live list. Snapshotting the StockLine means
  // the dialog keeps showing the balance from the moment it opened, even after a movement
  // lands — and a stale number in the stock-take field invites confirming a count that is
  // already out of date.
  const [activeId, setActiveId] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const active = stock?.find((s) => s.id === activeId);

  // Same DERIVED-not-snapshotted pattern for the item dialog: editing a row must keep
  // showing whatever the live list says, not the balance/thresholds as they looked when
  // the dialog opened.
  const [editId, setEditId] = useState<string | undefined>();
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const editing = stock?.find((s) => s.id === editId);

  function openItem(item: StockLine) {
    setActiveId(item.id);
    setOpen(true);
  }

  function openCreateItem() {
    setEditId(undefined);
    setItemDialogOpen(true);
  }

  function openEditItem(item: StockLine) {
    setEditId(item.id);
    setItemDialogOpen(true);
  }

  if (isError) {
    return (
      <div data-density="touch" className="flex flex-1 flex-col p-page">
        <div
          role="alert"
          className="flex items-start gap-sm rounded-2xl border border-destructive-border bg-destructive-subtle p-card text-destructive-subtle-foreground"
        >
          <AlertTriangle className="size-5 shrink-0" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="text-h2">Couldn&apos;t load stock.</p>
            <p className="max-w-measure text-small">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const reorder = stock?.filter((s) => s.needsReorder) ?? [];

  return (
    /* data-density="touch" is law L15: the store cupboard is counted standing up,
       on a tablet, so every control here is lifted to --tap. */
    <div data-density="touch" className="flex flex-1 flex-col gap-lg p-page">
      {/* The sentence is a garnish ON TOP OF the numbers below, never a replacement for
          them — see getInventoryAlert's own docs. A button, not a query: this spends
          shared Gemini quota, so it only ever runs from an explicit click. */}
      <Card className="rise" size="sm" style={{ "--i": 0 } as React.CSSProperties}>
        <CardContent className="flex flex-col gap-sm">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <div className="flex items-center gap-sm">
              <span className="grid size-tap-sm shrink-0 place-items-center rounded-md bg-brand-subtle text-brand-subtle-foreground">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-h2">AI restocking advice</p>
                <p className="max-w-measure text-small text-muted-foreground">
                  A plain-English read on what to reorder, on top of the list below.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => alert.mutate()}
              disabled={alert.isPending}
            >
              {alert.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-3.5" aria-hidden />
              )}
              {alert.isPending ? "Thinking…" : "Get AI restocking advice"}
            </Button>
          </div>

          {alert.data ? (
            <>
              <Separator />
              <p className="max-w-measure text-body">{alert.data.message}</p>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* The reorder list — the whole point of tracking stock. This is arithmetic, not
          an AI call: "how many days of chicken do I have" has an exact answer.
          --grad-card-warn is the wash every palette declares for exactly this banner. */}
      {reorder.length > 0 ? (
        <section
          aria-labelledby="reorder-heading"
          className="rise flex flex-col gap-sm rounded-2xl border border-warning-border bg-[image:var(--grad-card-warn)] p-card shadow-sm"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <div className="flex items-center gap-sm text-warning-subtle-foreground">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            <h2 id="reorder-heading" className="font-heading text-h2">
              {reorder.length} item{reorder.length === 1 ? "" : "s"} below the reorder line
            </h2>
          </div>

          <div className="grid gap-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {reorder.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className="rise flex flex-col gap-xs rounded-lg border border-warning-border bg-card p-card-sm text-left shadow-xs transition-all duration-(--dur) ease-quint hover:shadow-sm active:translate-y-px"
                onClick={() => openItem(item)}
                style={{ "--i": i + 2 } as React.CSSProperties}
              >
                <span className="truncate text-body font-semibold">{item.name}</span>
                <span className="font-num text-metric tabular-nums text-warning-subtle-foreground">
                  {item.daysLeft !== null ? item.daysLeft : item.currentStock}
                  <span className="ml-1 text-small font-normal text-muted-foreground">
                    {item.daysLeft !== null ? "days left" : item.unit}
                  </span>
                </span>
                <StockMeter item={item} />
                <span className="text-label tracking-label uppercase text-muted-foreground">
                  {item.currentStock}
                  {item.unit} on hand · line at {item.lowStockThreshold}
                  {item.unit}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Adding/removing an item from the catalogue is a manager's decision — same
          MANAGES_CATALOGUE roles the server enforces on POST/PATCH/DELETE, and the same
          set `canAdjust` already represents on this page (role !== STAFF). */}
      {canAdjust ? (
        <div className="flex items-center">
          <Button className="ml-auto shadow-brand" onClick={openCreateItem}>
            <Plus className="size-4" />
            New item
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead>Item</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Used / day</TableHead>
              <TableHead className="text-right">Days left</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="w-56" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {isPending ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow
                  key={i}
                  className="rise"
                  aria-busy
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <TableCell colSpan={6}>
                    <div className="flex items-center gap-sm">
                      <Skeleton className="h-3 w-40 rounded-hair" />
                      <Skeleton className="h-1.5 w-24 rounded-pill" />
                      <Skeleton className="ml-auto h-3 w-20 rounded-hair" />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : stock?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex min-h-40 flex-col items-center justify-center gap-sm rounded-xl border border-dashed border-input p-card text-center">
                    <span className="grid size-tap-sm place-items-center rounded-md bg-muted text-muted-foreground">
                      <Package className="size-5" aria-hidden />
                    </span>
                    <p className="max-w-measure text-small text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        Nothing in the store yet.
                      </span>{" "}
                      Add an item and every unit is accounted for from zero.
                    </p>
                    {canAdjust ? (
                      <Button size="sm" variant="outline" onClick={openCreateItem}>
                        Add the first one
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              stock?.map((item, i) => (
                <TableRow
                  key={item.id}
                  className={cn("rise", item.needsReorder && "bg-warning-subtle/50")}
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <TableCell>
                    <div className="flex items-center gap-sm">
                      <span className="font-semibold">{item.name}</span>
                      {item.needsReorder ? (
                        <Badge
                          variant="secondary"
                          className="border-warning-border bg-warning-subtle text-warning-subtle-foreground"
                        >
                          <span data-slot="badge-dot" />
                          reorder
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="font-num tabular-nums">
                        {item.currentStock} {item.unit}
                      </span>
                      <StockMeter item={item} />
                    </div>
                  </TableCell>

                  <TableCell className="text-right font-num tabular-nums text-muted-foreground">
                    {item.dailyUsage > 0 ? `${item.dailyUsage} ${item.unit}` : "—"}
                  </TableCell>

                  <TableCell className="text-right font-num tabular-nums">
                    {item.daysLeft === null ? (
                      // Not moving. "Infinity days left" would sort it to the top of a
                      // reorder list, which is the opposite of the truth.
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          item.daysLeft < 3 && "font-semibold text-warning-subtle-foreground",
                        )}
                      >
                        {item.daysLeft}d
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-small text-muted-foreground">
                    {item.supplier ?? "—"}
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-xs">
                      <Button size="sm" variant="outline" onClick={() => openItem(item)}>
                        Move stock
                      </Button>
                      {/* Item management (create/edit/delete) — a different action from
                          recording a movement above. Manager+ only, same as the server. */}
                      {canAdjust ? (
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
                            <DropdownMenuItem onClick={() => openEditItem(item)}>
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
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <MovementDialog
        restaurantId={restaurantId}
        item={active}
        canAdjust={canAdjust}
        open={open}
        onOpenChange={setOpen}
      />

      <InventoryItemDialog
        restaurantId={restaurantId}
        item={editing}
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
      />
    </div>
  );
}
