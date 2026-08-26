"use client";

import { Minus, Plus, Search, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

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
import { useCustomers, type Customer } from "@/hooks/use-customers";
import { useMenuItems } from "@/hooks/use-menu";
import { useCreateOrder, useTables } from "@/hooks/use-orders";
import type { OrderType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

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

/** The field label, everywhere in this sheet. One class string, one decision. */
const FIELD_LABEL = "text-label tracking-label uppercase";

/**
 * The statutory FSSAI mark: a square outline carrying a filled CIRCLE for veg and a
 * filled TRIANGLE for non-veg, green and maroon respectively. It is a legal label, not
 * a palette decision — which is why --veg / --nonveg hold the same two colours in all
 * eight theme combinations.
 *
 * The inner glyph, not the hue, is what separates the two states: veg and nonveg
 * measure only dE2000 5.90–10.47 apart under simulated deuteranopia, so a mark that
 * differed by colour alone (which this one did — a dot in both states) was unreadable
 * to a red-green dichromat in every palette. It is also no longer aria-hidden: this is
 * the only place the veg status appears on an order line, so hiding it left the
 * information available to sighted users only.
 */
function VegMark({ isVeg }: { isVeg: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={isVeg ? "Vegetarian" : "Non-vegetarian"}
      className={cn("size-3.5 shrink-0", isVeg ? "text-veg" : "text-nonveg")}
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
  );
}

/** One line of the running tally, with a dot leader between name and figure. */
function TallyRow({
  label,
  value,
  total = false,
}: {
  label: string;
  value: string;
  total?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-sm",
        total && "border-t border-input pt-xs text-body font-semibold text-foreground",
      )}
    >
      <span className={total ? undefined : "text-muted-foreground"}>{label}</span>
      <span aria-hidden className="-translate-y-1 flex-1 border-b border-dotted border-input" />
      <span className="font-num tabular-nums">{value}</span>
    </div>
  );
}

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
      <DialogContent className="sm:max-w-2xl" data-testid="new-order-dialog">
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

  // Walk-in by default (customer = null). Storing the whole record, not just an id, so the
  // chip still reads correctly after the search box that found it is cleared.
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const deferredCustomerSearch = useDeferredValue(customerSearch.trim());
  const { data: customerMatches } = useCustomers(restaurantId, {
    search: deferredCustomerSearch || undefined,
  });

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
        customerId: customer?.id ?? null,
        discount: discountValue,
        // Only WHAT and HOW MANY. The price is the server's business — see
        // src/lib/orders/service.ts.
        items: lines.map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-lg">
      <div className="grid gap-sm sm:grid-cols-2">
        <div className="grid gap-xs">
          <Label htmlFor="type" className={FIELD_LABEL}>
            Type
          </Label>
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

        <div className="grid gap-xs">
          <Label htmlFor="table" className={FIELD_LABEL}>
            Table
          </Label>
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

      <div className="grid gap-xs">
        <Label htmlFor="customer-search" className={FIELD_LABEL}>
          Customer
        </Label>
        {customer ? (
          <div className="flex min-h-tap items-center gap-sm rounded-lg border border-border bg-muted/60 px-3 text-body">
            <span className="font-semibold">{customer.name}</span>
            <span className="font-num text-small tabular-nums text-muted-foreground">
              {customer.phone}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="Remove customer"
              onClick={() => setCustomer(null)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="customer-search"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Search by name or phone — leave blank for a walk-in…"
              className="pl-9"
              data-testid="customer-search-input"
            />
            {customerSearch.trim() ? (
              <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                {customerMatches?.length ? (
                  customerMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex min-h-tap w-full items-center gap-sm rounded-md px-3 text-left text-body transition-colors duration-(--dur) ease-quint hover:bg-muted"
                      data-testid="customer-search-result"
                      onClick={() => {
                        setCustomer(c);
                        setCustomerSearch("");
                      }}
                    >
                      <span className="font-semibold">{c.name}</span>
                      <span className="font-num text-small tabular-nums text-muted-foreground">
                        {c.phone}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="p-card-sm text-center text-small text-muted-foreground">
                    No customer matches that.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="grid gap-xs">
        <Label htmlFor="dish-search" className={FIELD_LABEL}>
          Dishes
        </Label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="dish-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
            className="pl-9"
            data-testid="dish-search-input"
          />
        </div>

        <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-card p-1">
          {sellable.length === 0 ? (
            <p className="p-card text-center text-small text-muted-foreground">
              No dishes match.
            </p>
          ) : (
            sellable.map((item) => {
              const n = qty[item.id] ?? 0;
              return (
                <div
                  key={item.id}
                  data-picked={n > 0 || undefined}
                  className={cn(
                    "flex min-h-14 items-center gap-sm rounded-md px-2 transition-colors duration-(--dur) ease-quint",
                    // A picked line is a WASH plus an inset edge, not a tint alone —
                    // the quantity beside it is the fact, this is the fast scan.
                    n > 0
                      ? "bg-brand-subtle text-brand-subtle-foreground inset-ring inset-ring-brand/20"
                      : "hover:bg-muted",
                  )}
                >
                  <VegMark isVeg={item.isVeg} />
                  <span className="min-w-0 flex-1 truncate text-body font-medium">
                    {item.name}
                  </span>
                  <span className="w-16 text-right font-num text-small tabular-nums text-muted-foreground">
                    {inr.format(item.price)}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Remove one ${item.name}`}
                      disabled={n === 0}
                      onClick={() => bump(item.id, -1)}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <span className="w-7 text-center font-num text-body tabular-nums">{n}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Add one ${item.name}`}
                      onClick={() => bump(item.id, 1)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="grid gap-lg sm:grid-cols-2">
        <div className="grid content-start gap-xs">
          <Label htmlFor="discount" className={FIELD_LABEL}>
            Discount (₹)
          </Label>
          <Input
            id="discount"
            type="number"
            min="0"
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="font-num tabular-nums"
          />
        </div>

        {/* The running tally, on a dot-leader ledger. It is a PREVIEW — see TAX_RATE. */}
        <div className="grid content-end gap-xs rounded-xl border border-border bg-muted/60 p-card-sm text-small">
          <TallyRow label="Subtotal" value={inr.format(subtotal)} />
          {discountValue > 0 ? (
            <TallyRow label="Discount" value={`−${inr.format(discountValue)}`} />
          ) : null}
          <TallyRow label="GST (5%)" value={inr.format(tax)} />
          <TallyRow label="Total" value={inr.format(total)} total />
        </div>
      </div>

      <DialogFooter className="items-center">
        <Badge variant="secondary" className="mr-auto font-num tabular-nums">
          {lines.reduce((n, [, q]) => n + q, 0)} item
          {lines.reduce((n, [, q]) => n + q, 0) === 1 ? "" : "s"}
        </Badge>
        <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="shadow-brand"
          disabled={lines.length === 0 || create.isPending}
          data-testid="place-order-submit"
        >
          {create.isPending ? "Placing…" : "Place order"}
        </Button>
      </DialogFooter>
    </form>
  );
}
