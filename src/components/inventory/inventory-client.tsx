"use client";

import { AlertTriangle, Package } from "lucide-react";
import { useState } from "react";

import { MovementDialog } from "@/components/inventory/movement-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStock, type StockLine } from "@/hooks/use-inventory";

export function InventoryClient({
  restaurantId,
  canAdjust,
}: {
  restaurantId: string;
  /** A stock-take is the only unbounded write to the balance — managers only. */
  canAdjust: boolean;
}) {
  const { data: stock, isPending, isError, error } = useStock(restaurantId);

  // Hold the ID and DERIVE the item from the live list. Snapshotting the StockLine means
  // the dialog keeps showing the balance from the moment it opened, even after a movement
  // lands — and a stale number in the stock-take field invites confirming a count that is
  // already out of date.
  const [activeId, setActiveId] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const active = stock?.find((s) => s.id === activeId);

  function openItem(item: StockLine) {
    setActiveId(item.id);
    setOpen(true);
  }

  if (isError) {
    return (
      <p className="text-destructive p-6 text-sm">Couldn&apos;t load stock: {error.message}</p>
    );
  }

  const reorder = stock?.filter((s) => s.needsReorder) ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Used / day</TableHead>
              <TableHead className="text-right">Days left</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="w-24" />
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
                    <Button size="sm" variant="outline" onClick={() => openItem(item)}>
                      Move stock
                    </Button>
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
    </div>
  );
}
