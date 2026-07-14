"use client";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApplyMovement, useMovements, type StockLine } from "@/hooks/use-inventory";
import type { TransactionType } from "@/generated/prisma/enums";

const MOVEMENT_LABEL: Record<TransactionType, string> = {
  STOCK_IN: "Delivery in",
  STOCK_OUT: "Used",
  WASTE: "Wasted",
  ADJUSTMENT: "Stock take",
};

/** Waste and stock-takes must say why — see src/lib/validations/inventory.ts. */
const NEEDS_NOTE: TransactionType[] = ["WASTE", "ADJUSTMENT"];

export function MovementDialog({
  restaurantId,
  item,
  canAdjust,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  /**
   * DERIVED from the live stock list, never a snapshot. Hold a copy of the item and the
   * dialog goes on showing the balance as it was when you opened it — including in the
   * stock-take placeholder, where a stale number is an invitation to confirm a count that
   * is already wrong.
   */
  item?: StockLine;
  canAdjust: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item?.name ?? "Stock"}</DialogTitle>
          <DialogDescription>
            {item
              ? `${item.currentStock} ${item.unit} in stock · ${item.dailyUsage} ${item.unit}/day`
              : null}
          </DialogDescription>
        </DialogHeader>
        {open && item ? (
          <MovementForm
            key={item.id}
            restaurantId={restaurantId}
            item={item}
            canAdjust={canAdjust}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MovementForm({
  restaurantId,
  item,
  canAdjust,
}: {
  restaurantId: string;
  item: StockLine;
  canAdjust: boolean;
}) {
  const apply = useApplyMovement(restaurantId, item.id);
  const { data: movements } = useMovements(restaurantId, item.id);

  const [type, setType] = useState<TransactionType>("STOCK_IN");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const isStockTake = type === "ADJUSTMENT";
  const noteRequired = NEEDS_NOTE.includes(type);
  const value = Number(amount);
  const canSubmit =
    amount !== "" && !Number.isNaN(value) && (!noteRequired || notes.trim() !== "");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    // A stock-take states what was COUNTED — an absolute. Everything else states an amount
    // that moved. The server computes the delta under the row lock, against the balance as
    // it actually is rather than as it looked when this form was opened.
    const input = isStockTake
      ? ({ type: "ADJUSTMENT", countedStock: value, notes: notes.trim() } as const)
      : ({ type, quantity: value, notes: notes.trim() || null } as const);

    apply.mutate(input as never, {
      onSuccess: () => {
        setAmount("");
        setNotes("");
      },
    });
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="type">What happened</Label>
            <Select
              value={type}
              onValueChange={(v) => setType((v ?? "STOCK_IN") as TransactionType)}
            >
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STOCK_IN">Delivery arrived</SelectItem>
                <SelectItem value="STOCK_OUT">Used in service</SelectItem>
                <SelectItem value="WASTE">Wasted / spoiled</SelectItem>
                {/* A stock-take is the only unbounded write to the balance — manager only. */}
                {canAdjust ? <SelectItem value="ADJUSTMENT">Stock take</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amount">
              {isStockTake ? `Counted (${item.unit})` : `Quantity (${item.unit})`}
            </Label>
            <Input
              id="amount"
              type="number"
              step="0.001"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={isStockTake ? String(item.currentStock) : "0"}
            />
            {isStockTake ? (
              <p className="text-muted-foreground text-xs">
                What&apos;s actually on the shelf — not the difference.
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="notes">
            Note
            {noteRequired ? null : (
              <span className="text-muted-foreground font-normal"> (optional)</span>
            )}
          </Label>
          <Input
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              type === "WASTE"
                ? "What happened to it?"
                : isStockTake
                  ? "Why does the count differ?"
                  : "Optional"
            }
            aria-invalid={noteRequired && notes.trim() === "" && amount !== ""}
          />
        </div>

        <Button type="submit" disabled={!canSubmit || apply.isPending}>
          {apply.isPending ? "Recording…" : "Record"}
        </Button>
      </form>

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium">
          Recent movements — every unit accounted for
        </p>
        <div className="max-h-56 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements?.length ? (
                movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <Badge variant="secondary" className="w-fit">
                          {MOVEMENT_LABEL[m.type]}
                        </Badge>
                        <span className="text-muted-foreground mt-0.5 text-xs">
                          {[m.user?.name, m.notes].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </div>
                    </TableCell>

                    {/* The SIGNED delta. `quantity` is a magnitude, and a sign guessed from
                        the type reads a stock-take that found LESS as a gain — wrong by
                        twice the delta, in the wrong direction. See
                        InventoryTransaction.delta in the schema. */}
                    <TableCell
                      className={`text-right tabular-nums ${m.delta < 0 ? "text-destructive" : ""}`}
                    >
                      {m.delta > 0 ? "+" : ""}
                      {m.delta}
                    </TableCell>

                    <TableCell className="text-right font-medium tabular-nums">
                      {m.balanceAfter}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-center text-sm">
                    No movements yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
