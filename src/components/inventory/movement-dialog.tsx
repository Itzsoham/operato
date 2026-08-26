"use client";

import { ArrowDownRight, ArrowUpRight, ScrollText } from "lucide-react";
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
import { cn } from "@/lib/utils";

const MOVEMENT_LABEL: Record<TransactionType, string> = {
  STOCK_IN: "Delivery in",
  STOCK_OUT: "Used",
  WASTE: "Wasted",
  ADJUSTMENT: "Stock take",
};

/** What the person recording it would call each movement. */
const MOVEMENT_OPTION: Record<TransactionType, string> = {
  STOCK_IN: "Delivery arrived",
  STOCK_OUT: "Used in service",
  WASTE: "Wasted / spoiled",
  ADJUSTMENT: "Stock take",
};

/** Waste and stock-takes must say why — see src/lib/validations/inventory.ts. */
const NEEDS_NOTE: TransactionType[] = ["WASTE", "ADJUSTMENT"];

/** The field label, everywhere in this sheet. */
const FIELD_LABEL = "text-label tracking-label uppercase";

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
            {item ? (
              <span className="font-num tabular-nums">
                {item.currentStock} {item.unit} in stock · {item.dailyUsage} {item.unit}/day
              </span>
            ) : null}
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
    <div className="grid gap-lg">
      <form onSubmit={onSubmit} className="grid gap-sm">
        <div className="grid gap-sm sm:grid-cols-2">
          <div className="grid gap-xs">
            <Label htmlFor="type" className={FIELD_LABEL}>
              What happened
            </Label>
            <Select
              value={type}
              onValueChange={(v) => setType((v ?? "STOCK_IN") as TransactionType)}
            >
              <SelectTrigger id="type">
                {/* Base UI renders the RAW VALUE without a render function — "STOCK_IN". */}
                <SelectValue>
                  {(value) => MOVEMENT_OPTION[value as TransactionType]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STOCK_IN">{MOVEMENT_OPTION.STOCK_IN}</SelectItem>
                <SelectItem value="STOCK_OUT">{MOVEMENT_OPTION.STOCK_OUT}</SelectItem>
                <SelectItem value="WASTE">{MOVEMENT_OPTION.WASTE}</SelectItem>
                {/* A stock-take is the only unbounded write to the balance — manager only. */}
                {canAdjust ? (
                  <SelectItem value="ADJUSTMENT">{MOVEMENT_OPTION.ADJUSTMENT}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-xs">
            <Label htmlFor="amount" className={FIELD_LABEL}>
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
              className="font-num tabular-nums"
            />
            {isStockTake ? (
              <p className="text-small text-muted-foreground">
                What&apos;s actually on the shelf — not the difference.
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-xs">
          <Label htmlFor="notes" className={FIELD_LABEL}>
            Note
            {noteRequired ? null : (
              <span className="font-normal normal-case tracking-normal text-muted-foreground">
                {" "}
                (optional)
              </span>
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

        <Button type="submit" className="shadow-brand" disabled={!canSubmit || apply.isPending}>
          {apply.isPending ? "Recording…" : "Record"}
        </Button>
      </form>

      {/* THE LEDGER. Every row states its delta THREE ways — an arrow glyph, an
          explicit sign, and the delta/balance colour pair — because a signed number
          told in colour alone is a number half the shift cannot read. */}
      <div className="grid gap-xs">
        <p className="flex items-center gap-xs text-label tracking-label uppercase text-muted-foreground">
          <ScrollText className="size-3.5" aria-hidden />
          Recent movements — every unit accounted for
        </p>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements?.length ? (
                movements.map((m, i) => (
                  <TableRow
                    key={m.id}
                    className="rise"
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant="secondary" className="w-fit">
                          <span data-slot="badge-dot" />
                          {MOVEMENT_LABEL[m.type]}
                        </Badge>
                        <span className="text-small text-muted-foreground">
                          {[m.user?.name, m.notes].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </div>
                    </TableCell>

                    {/* The SIGNED delta. `quantity` is a magnitude, and a sign guessed from
                        the type reads a stock-take that found LESS as a gain — wrong by
                        twice the delta, in the wrong direction. See
                        InventoryTransaction.delta in the schema. */}
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "inline-flex items-center justify-end gap-1 font-num font-semibold tabular-nums",
                          m.delta > 0 && "text-delta-up",
                          m.delta < 0 && "text-delta-down",
                          m.delta === 0 && "text-muted-foreground",
                        )}
                      >
                        {m.delta > 0 ? (
                          <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
                        ) : m.delta < 0 ? (
                          <ArrowDownRight className="size-3.5 shrink-0" aria-hidden />
                        ) : null}
                        {m.delta > 0 ? "+" : ""}
                        {m.delta}
                      </span>
                    </TableCell>

                    <TableCell className="text-right font-num font-semibold tabular-nums">
                      {m.balanceAfter}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3}>
                    <p className="py-card-sm text-center text-small text-muted-foreground">
                      No movements yet. The first delivery opens the ledger.
                    </p>
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
