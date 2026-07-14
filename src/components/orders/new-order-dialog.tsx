"use client";

import { Minus, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import { useMenuItems } from "@/hooks/use-menu";
import { useCreateOrder, useTables } from "@/hooks/use-orders";
import type { OrderType } from "@/generated/prisma/enums";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

/**
 * Must match TAX_RATE in src/lib/orders/service.ts.
 *
 * This is a PREVIEW, not the price. The server recomputes every figure from the menu and
 * its answer is the one that counts — if these ever disagree, the server is right and
 * this number is a bug. It exists so the person at the till can read a total out loud
 * before committing.
 */
const TAX_RATE = 0.05;

const NO_TABLE = "__none__";

const TYPE_LABEL: Record<OrderType, string> = {
  DINE_IN: "Dine in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

export function NewOrderDialog({
  restaurantId,
  open,
  onOpenChange,
  presetTableId,
}: {
  restaurantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetTableId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>Pick the dishes, then send it to the kitchen.</DialogDescription>
        </DialogHeader>
        {open ? (
          <NewOrderForm
            key={presetTableId ?? "new"}
            restaurantId={restaurantId}
            presetTableId={presetTableId}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewOrderForm({
  restaurantId,
  presetTableId,
  onDone,
}: {
  restaurantId: string;
  presetTableId?: string;
  onDone: () => void;
}) {
  const { data: menu } = useMenuItems(restaurantId);
  const { data: tables } = useTables(restaurantId);
  const create = useCreateOrder(restaurantId);

  const [search, setSearch] = useState("");
  const [type, setType] = useState<OrderType>(presetTableId ? "DINE_IN" : "TAKEAWAY");
  const [tableId, setTableId] = useState(presetTableId ?? NO_TABLE);
  const [discount, setDiscount] = useState("0");
  const [qty, setQty] = useState<Record<string, number>>({});

  // Only what the kitchen can actually make. The server checks this again — a menu
  // fetched two minutes ago can be stale — but there's no reason to offer it here.
  const sellable = useMemo(
    () =>
      (menu ?? [])
        .filter((item) => item.isAvailable)
        .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase())),
    [menu, search],
  );

  const lines = Object.entries(qty).filter(([, n]) => n > 0);

  const subtotal = lines.reduce((sum, [id, n]) => {
    const item = menu?.find((m) => m.id === id);
    return sum + (item ? item.price * n : 0);
  }, 0);

  const discountValue = Math.min(Number(discount) || 0, subtotal);
  const tax = Math.round((subtotal - discountValue) * TAX_RATE * 100) / 100;
  const total = Math.round((subtotal - discountValue + tax) * 100) / 100;

  function bump(id: string, delta: number) {
    setQty((old) => {
      const next = Math.max(0, (old[id] ?? 0) + delta);
      const copy = { ...old };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (lines.length === 0) return;

    create.mutate(
      {
        type,
        tableId: type === "DINE_IN" && tableId !== NO_TABLE ? tableId : null,
        discount: discountValue,
        // Only WHAT and HOW MANY. The price is the server's business — see
        // src/lib/orders/service.ts.
        items: lines.map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="type">Type</Label>
          <Select value={type} onValueChange={(v) => setType((v ?? "TAKEAWAY") as OrderType)}>
            <SelectTrigger id="type">
              {/* Base UI's SelectValue renders the RAW VALUE without a render function —
                  it would show "DINE_IN" at the person taking the order. */}
              <SelectValue>{(value) => TYPE_LABEL[value as OrderType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DINE_IN">{TYPE_LABEL.DINE_IN}</SelectItem>
              <SelectItem value="TAKEAWAY">{TYPE_LABEL.TAKEAWAY}</SelectItem>
              <SelectItem value="DELIVERY">{TYPE_LABEL.DELIVERY}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="table">Table</Label>
          <Select
            value={tableId}
            onValueChange={(v) => setTableId(v ?? NO_TABLE)}
            disabled={type !== "DINE_IN"}
          >
            <SelectTrigger id="table">
              <SelectValue placeholder="No table">
                {(value) => {
                  if (value === NO_TABLE) return "No table";
                  const table = tables?.find((t) => t.id === value);
                  return table ? `Table ${table.number}` : "No table";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TABLE}>No table</SelectItem>
              {tables?.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  Table {t.number}
                  {t.label ? ` · ${t.label}` : ""}
                  {t.status === "OCCUPIED" ? " (occupied)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="dish-search">Dishes</Label>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input
            id="dish-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
            className="pl-8"
          />
        </div>

        <div className="max-h-56 overflow-y-auto rounded-md border">
          {sellable.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">No dishes match.</p>
          ) : (
            sellable.map((item) => {
              const n = qty[item.id] ?? 0;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
                >
                  <span
                    aria-hidden
                    className={`size-2.5 shrink-0 rounded-full ${item.isVeg ? "bg-green-600" : "bg-red-600"}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                  <span className="text-muted-foreground w-16 text-right text-sm tabular-nums">
                    {inr.format(item.price)}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-7"
                      aria-label={`Remove one ${item.name}`}
                      disabled={n === 0}
                      onClick={() => bump(item.id, -1)}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{n}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-7"
                      aria-label={`Add one ${item.name}`}
                      onClick={() => bump(item.id, 1)}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="discount">Discount (₹)</Label>
          <Input
            id="discount"
            type="number"
            min="0"
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </div>

        <div className="flex flex-col justify-end gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{inr.format(subtotal)}</span>
          </div>
          {discountValue > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span className="tabular-nums">−{inr.format(discountValue)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span className="text-muted-foreground">GST (5%)</span>
            <span className="tabular-nums">{inr.format(tax)}</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{inr.format(total)}</span>
          </div>
        </div>
      </div>

      <DialogFooter className="items-center">
        <Badge variant="secondary" className="mr-auto">
          {lines.reduce((n, [, q]) => n + q, 0)} item
          {lines.reduce((n, [, q]) => n + q, 0) === 1 ? "" : "s"}
        </Badge>
        <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={lines.length === 0 || create.isPending}>
          {create.isPending ? "Placing…" : "Place order"}
        </Button>
      </DialogFooter>
    </form>
  );
}
