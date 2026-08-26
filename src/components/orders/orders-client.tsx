"use client";

import { AlertTriangle, Armchair, Loader2, Plus, Receipt, Utensils } from "lucide-react";
import { useState } from "react";

import { NewOrderDialog } from "@/components/orders/new-order-dialog";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OrderStatus } from "@/generated/prisma/enums";
import {
  useOrderHistory,
  useOrders,
  usePayOrder,
  useTables,
  useUpdateOrderStatus,
  type FloorTable,
  type Order,
} from "@/hooks/use-orders";
import { cn } from "@/lib/utils";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** The next step in the kitchen's life of an order. PAID is not here — that's /pay. */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: "PREPARING",
  CONFIRMED: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
};

/**
 * How far through the five-step ramp a status sits, printed as a WORD next to the
 * chip's meter. The meter is the fast read; this is the one a screen reader gets and
 * the one that survives a monochrome kitchen printout.
 */
const STEP_OF: Partial<Record<OrderStatus, string>> = {
  PENDING: "step 1 of 5",
  CONFIRMED: "step 1 of 5",
  PREPARING: "step 2 of 5",
  READY: "step 3 of 5",
  SERVED: "step 4 of 5",
  PAID: "step 5 of 5",
};

/* ── The three states every list on this screen owes the person reading it ──────
   A kitchen screen that shows nothing has to say WHICH nothing it means: still
   loading, genuinely empty, or broken. All three are drawn in the system — the
   skeleton on --animate-shimmer (opacity only; a sliding skeleton reads as content
   arriving, four times a second, on a bad connection), the empty state as a dashed
   well, the error on the destructive -subtle triple. */

function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-xs" aria-busy aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rise flex items-center gap-sm rounded-xl border border-border bg-card p-card-sm shadow-xs"
          style={{ "--i": i } as React.CSSProperties}
        >
          <Skeleton className="h-tap-sm w-24 shrink-0 rounded-md" />
          <Skeleton className="h-3 flex-1 rounded-hair" />
          <Skeleton className="h-3 w-16 shrink-0 rounded-hair" />
        </div>
      ))}
      <p className="flex items-center gap-xs pt-xs text-small text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Fetching the latest from the pass…
      </p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-sm rounded-xl border border-dashed border-input p-card text-center">
      <span className="grid size-tap-sm place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="max-w-measure text-small text-muted-foreground">
        <span className="font-semibold text-foreground">{title}</span>
        {hint ? <> {hint}</> : null}
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-sm rounded-xl border border-destructive-border bg-destructive-subtle p-card text-destructive-subtle-foreground"
    >
      <AlertTriangle className="size-5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="text-h2">That didn&apos;t load.</p>
        <p className="max-w-measure text-small">{message}</p>
      </div>
    </div>
  );
}

export function OrdersClient({ restaurantId }: { restaurantId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [presetTable, setPresetTable] = useState<string | undefined>();

  const open = useOrders(restaurantId, { open: true });
  const tables = useTables(restaurantId);

  function newOrder(tableId?: string) {
    setPresetTable(tableId);
    setDialogOpen(true);
  }

  return (
    /* data-density="touch" is law L15: an operational screen is tapped mid-service
       with wet hands, so every control in this subtree is lifted to --tap (44px, 46
       in Forno). The dialogs portal OUT of here, which is why they keep desktop
       density. */
    <div data-density="touch" className="flex flex-1 flex-col gap-lg p-page">
      <Tabs defaultValue="floor">
        <div className="flex flex-wrap items-center gap-sm">
          <TabsList>
            <TabsTrigger value="floor" data-testid="tab-floor">
              <Armchair className="size-4" />
              Floor
            </TabsTrigger>
            <TabsTrigger value="open" data-testid="tab-open">
              <Receipt className="size-4" />
              Open
              {open.data?.length ? (
                <Badge variant="secondary" className="ml-1 font-num tabular-nums">
                  {open.data.length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              History
            </TabsTrigger>
          </TabsList>

          <Button
            className="ml-auto shadow-brand"
            onClick={() => newOrder()}
            data-testid="new-order-button"
          >
            <Plus className="size-4" />
            New order
          </Button>
        </div>

        <TabsContent value="floor" className="mt-lg">
          <FloorGrid
            tables={tables.data}
            isPending={tables.isPending}
            isError={tables.isError}
            error={tables.error}
            onPick={newOrder}
          />
        </TabsContent>

        <TabsContent value="open" className="mt-lg">
          <OrderList
            restaurantId={restaurantId}
            orders={open.data}
            isPending={open.isPending}
            isError={open.isError}
            error={open.error}
            emptyTitle="Nothing cooking."
            emptyHint="Every order is settled."
          />
        </TabsContent>

        <TabsContent value="history" className="mt-lg">
          <OrderHistoryPanel restaurantId={restaurantId} />
        </TabsContent>
      </Tabs>

      <NewOrderDialog
        restaurantId={restaurantId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        presetTableId={presetTable}
      />
    </div>
  );
}

/**
 * THE FLOOR. Each tile is the table's state at a glance: the number set in the
 * display face, an occupancy meter of seat pips, the live ticket's status chip, and
 * the money outstanding along the bottom rule.
 *
 * A free table is DASHED and unelevated; a working table is a solid, lifted card.
 * That is the same state told twice before colour is involved at all.
 */
function FloorGrid({
  tables,
  isPending,
  isError,
  error,
  onPick,
}: {
  tables?: FloorTable[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  onPick: (tableId: string) => void;
}) {
  if (isError) return <ErrorState message={error?.message ?? "Couldn't load the floor."} />;

  if (isPending) {
    return (
      <div className="grid gap sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton
            key={i}
            className="rise h-40 rounded-xl"
            style={{ "--i": i } as React.CSSProperties}
          />
        ))}
      </div>
    );
  }

  if (!tables?.length) {
    return (
      <EmptyState
        icon={Armchair}
        title="No tables laid out yet."
        hint="Add tables and the floor plan fills in here."
      />
    );
  }

  return (
    <div className="grid gap sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {tables.map((table, i) => {
        const live = table.orders[0];
        const ready = live?.status === "READY";
        const occupied = Boolean(live) || table.status === "OCCUPIED";

        return (
          <button
            key={table.id}
            type="button"
            data-testid="floor-tile"
            data-table-status={table.status}
            data-order-status={live?.status}
            /* `tile--ready` is the hook globals.css already reaches for to kill the
               pulse under prefers-reduced-motion — the animation is never the only
               signal, the chip and the rule carry it too. */
            className={cn(
              "rise group/tile flex min-h-40 flex-col gap-sm rounded-xl border p-card-sm text-left",
              "transition-all duration-(--dur) ease-quint",
              "hover:shadow focus-visible:z-10 active:translate-y-px",
              occupied
                ? "border-border bg-card shadow-sm"
                : "border-dashed border-input bg-transparent hover:bg-muted/60",
              ready && "tile--ready animate-ready-pulse border-ready shadow-ready",
            )}
            onClick={() => onPick(table.id)}
            style={{ "--i": i } as React.CSSProperties}
          >
            <span className="flex items-start gap-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-heading text-h1 leading-none">
                  {table.number}
                </span>
                <span className="mt-1 block truncate text-label tracking-label uppercase text-muted-foreground">
                  {table.label ?? "Table"}
                </span>
              </span>

              {/* Occupancy, told as pips AND as a number — never as pips alone. */}
              <span className="shrink-0 text-right">
                <span aria-hidden className="flex justify-end gap-1">
                  {Array.from({ length: Math.min(table.capacity, 8) }).map((_, s) => (
                    <span
                      key={s}
                      className={cn(
                        "size-2 rounded-xs",
                        occupied ? "bg-foreground/70" : "bg-border",
                      )}
                    />
                  ))}
                </span>
                <span className="mt-1.5 block font-num text-label tabular-nums text-muted-foreground">
                  {table.capacity} seats
                </span>
              </span>
            </span>

            {live ? (
              <span className="flex flex-wrap items-center gap-xs">
                <OrderStatusBadge status={live.status} />
                <span className="font-num text-label tracking-label uppercase text-muted-foreground">
                  {STEP_OF[live.status]}
                </span>
              </span>
            ) : null}

            <span
              className={cn(
                "mt-auto flex items-baseline gap-sm border-t pt-sm",
                occupied ? "border-border" : "border-dashed border-input",
              )}
            >
              {live ? (
                <>
                  <span className="font-num text-small font-semibold text-brand-subtle-foreground">
                    {live.orderNumber}
                  </span>
                  <span className="ml-auto font-num text-metric tabular-nums">
                    {inr.format(live.totalAmount)}
                  </span>
                </>
              ) : (
                <span className="text-small text-muted-foreground">
                  Free · tap to open a ticket
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Closed orders, date-filterable and "Load more" paginated — see useOrderHistory. Its own
 * component because it owns date-range state the live Open/Floor tabs have no use for.
 */
function OrderHistoryPanel({ restaurantId }: { restaurantId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const history = useOrderHistory(restaurantId, {
    from: from || undefined,
    to: to || undefined,
  });
  const orders = history.data?.pages.flatMap((page) => page.orders);

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-end gap-sm rounded-xl border border-border bg-muted/60 p-card-sm">
        <div className="flex flex-col gap-xs">
          <Label htmlFor="history-from" className="text-label tracking-label uppercase">
            From
          </Label>
          <Input
            id="history-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40 font-num tabular-nums"
          />
        </div>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="history-to" className="text-label tracking-label uppercase">
            To
          </Label>
          <Input
            id="history-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="w-40 font-num tabular-nums"
          />
        </div>
        {from || to ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <OrderList
        restaurantId={restaurantId}
        orders={orders}
        isPending={history.isPending}
        isError={history.isError}
        error={history.error}
        emptyTitle="No completed orders yet."
        emptyHint="Settled tickets land here, newest first."
      />

      {history.hasNextPage ? (
        <Button
          variant="outline"
          className="mx-auto"
          disabled={history.isFetchingNextPage}
          onClick={() => history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading…
            </>
          ) : (
            "Load more"
          )}
        </Button>
      ) : null}
    </div>
  );
}

function OrderList({
  restaurantId,
  orders,
  isPending,
  isError,
  error,
  emptyTitle,
  emptyHint,
}: {
  restaurantId: string;
  orders?: Order[];
  isPending: boolean;
  isError?: boolean;
  error?: Error | null;
  emptyTitle: string;
  emptyHint?: string;
}) {
  const advance = useUpdateOrderStatus(restaurantId);
  const pay = usePayOrder(restaurantId);

  if (isError) return <ErrorState message={error?.message ?? "Couldn't load orders."} />;

  if (isPending) return <PanelSkeleton rows={4} />;

  if (!orders?.length) {
    return <EmptyState icon={Utensils} title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className="flex flex-col gap-xs">
      {orders.map((order, i) => {
        const next = NEXT_STATUS[order.status];
        // Pay only once the food is out. The server enforces this too — settling a
        // PENDING order marks its lines served and drops the ticket off the kitchen's
        // list, so the customer pays for food nobody ever cooked.
        const canPay = order.status === "READY" || order.status === "SERVED";
        const ready = order.status === "READY";

        return (
          <div
            key={order.id}
            data-testid="order-card"
            data-order-id={order.id}
            data-status={order.status}
            className={cn(
              "rise grid items-center gap-sm rounded-xl border bg-card p-card-sm shadow-xs",
              "transition-all duration-(--dur) ease-quint hover:border-input hover:shadow-sm",
              "lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto_auto]",
              ready ? "border-ready shadow-sm" : "border-border",
            )}
            style={{ "--i": i } as React.CSSProperties}
          >
            <div className="flex min-w-0 flex-col gap-xs">
              <div className="flex items-center gap-sm">
                <span className="font-num text-small font-semibold">{order.orderNumber}</span>
              </div>
              <div className="flex flex-wrap items-center gap-xs">
                <OrderStatusBadge status={order.status} />
                <span className="font-num text-label tracking-label uppercase text-muted-foreground">
                  {STEP_OF[order.status] ?? "voided"}
                </span>
              </div>
            </div>

            <div className="min-w-0">
              <p className="truncate text-body font-semibold">
                {order.table
                  ? `Table ${order.table.number}`
                  : order.type.replace("_", " ").toLowerCase()}
                {order.customer ? (
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {order.customer.name}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 truncate text-small text-muted-foreground">
                {order.orderItems
                  .map((line) => `${line.quantity}× ${line.menuItem.name}`)
                  .join(", ")}
              </p>
            </div>

            <span className="font-num text-h2 tabular-nums lg:text-right">
              {inr.format(order.totalAmount)}
            </span>

            <div className="flex flex-wrap items-center gap-xs">
              {next ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={advance.isPending}
                  onClick={() => advance.mutate({ id: order.id, status: next })}
                  data-testid="advance-order-button"
                >
                  {next.toLowerCase()}
                </Button>
              ) : null}

              {canPay ? (
                <Button
                  size="sm"
                  disabled={pay.isPending}
                  onClick={() => pay.mutate(order.id)}
                  data-testid="pay-order-button"
                >
                  Pay
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
