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
      <p className="text-destructive p-6 text-sm">Couldn&apos;t load stock: {error.message}</p>
    );
  }

  const reorder = stock?.filter((s) => s.needsReorder) ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* The sentence is a garnish ON TOP OF the numbers below, never a replacement for
          them — see getInventoryAlert's own docs. A button, not a query: this spends
          shared Gemini quota, so it only ever runs from an explicit click. */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="text-primary size-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">AI restocking advice</p>
                <p className="text-muted-foreground text-xs">
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
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {alert.isPending ? "Thinking…" : "Get AI restocking advice"}
            </Button>
          </div>

          {alert.data ? (
            <>
              <Separator />
              <p className="text-sm">{alert.data.message}</p>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* The reorder list — the whole point of tracking stock. This is arithmetic, not
          an AI call: "how many days of chicken do I have" has an exact answer. */}
      {reorder.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500" />
              <span className="font-medium">
                {reorder.length} item{reorder.length === 1 ? "" : "s"} below the reorder line
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {reorder.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant="outline"
                  className="bg-background"
                  onClick={() => openItem(item)}
                >
                  {item.name}
                  <span className="text-muted-foreground">
                    {item.daysLeft !== null
                      ? `${item.daysLeft}d left`
                      : `${item.currentStock}${item.unit}`}
                  </span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Adding/removing an item from the catalogue is a manager's decision — same
          MANAGES_CATALOGUE roles the server enforces on POST/PATCH/DELETE, and the same
          set `canAdjust` already represents on this page (role !== STAFF). */}
      {canAdjust ? (
        <div className="flex items-center">
          <Button className="ml-auto" onClick={openCreateItem}>
            <Plus className="size-4" />
            New item
          </Button>
        </div>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Used / day</TableHead>
              <TableHead className="text-right">Days left</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="w-48" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {isPending ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : stock?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-lg">
                      <Package className="size-5" />
                    </div>
                    <p className="text-muted-foreground text-sm">Nothing in the store yet.</p>
                    {canAdjust ? (
                      <Button size="sm" variant="outline" onClick={openCreateItem}>
                        Add the first one
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              stock?.map((item) => (
                <TableRow key={item.id} className={item.needsReorder ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      {item.needsReorder ? (
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                        >
                          reorder
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {item.currentStock} {item.unit}
                  </TableCell>

                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {item.dailyUsage > 0 ? `${item.dailyUsage} ${item.unit}` : "—"}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {item.daysLeft === null ? (
                      // Not moving. "Infinity days left" would sort it to the top of a
                      // reorder list, which is the opposite of the truth.
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={item.daysLeft < 3 ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
                        {item.daysLeft}d
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-muted-foreground text-sm">
                    {item.supplier ?? "—"}
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
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
                                size="icon"
                                className="size-8"
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
