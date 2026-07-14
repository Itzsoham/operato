"use client";

import { Armchair, Plus, Receipt } from "lucide-react";
import { useState } from "react";

import { NewOrderDialog } from "@/components/orders/new-order-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OrderStatus } from "@/generated/prisma/enums";
import {
  useOrders,
  usePayOrder,
  useTables,
  useUpdateOrderStatus,
  type Order,
} from "@/hooks/use-orders";

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

const STATUS_STYLE: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  CONFIRMED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  PREPARING: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  READY: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  SERVED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  PAID: "bg-muted text-muted-foreground",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

export function OrdersClient({ restaurantId }: { restaurantId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [presetTable, setPresetTable] = useState<string | undefined>();

  const open = useOrders(restaurantId, { open: true });
  const history = useOrders(restaurantId, { open: false });
  const tables = useTables(restaurantId);

  function newOrder(tableId?: string) {
    setPresetTable(tableId);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Tabs defaultValue="floor">
        <div className="flex items-center gap-2">
          <TabsList>
            <TabsTrigger value="floor">
              <Armchair className="size-4" />
              Floor
            </TabsTrigger>
            <TabsTrigger value="open">
              <Receipt className="size-4" />
              Open
              {open.data?.length ? (
                <Badge variant="secondary" className="ml-1">
                  {open.data.length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <Button className="ml-auto" onClick={() => newOrder()}>
            <Plus className="size-4" />
            New order
          </Button>
        </div>

        <TabsContent value="floor" className="mt-4">
          {tables.isPending ? (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {tables.data?.map((table) => {
                const live = table.orders[0];
                return (
                  <Card
                    key={table.id}
                    className={`cursor-pointer transition-colors ${
                      live ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50"
                    }`}
                    onClick={() => newOrder(table.id)}
                  >
                    <CardContent className="flex flex-col gap-1 p-4">
                      <div className="flex items-baseline justify-between">
                        <span className="font-medium">Table {table.number}</span>
                        <span className="text-muted-foreground text-xs">
                          {table.capacity} seats
                        </span>
                      </div>
                      {table.label ? (
                        <span className="text-muted-foreground text-xs">{table.label}</span>
                      ) : null}

                      {live ? (
                        <div className="mt-1 flex items-center justify-between text-sm">
                          <span className="font-medium">{live.orderNumber}</span>
                          <span className="tabular-nums">{inr.format(live.totalAmount)}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground mt-1 text-sm">Free</span>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="open" className="mt-4">
          <OrderList
            restaurantId={restaurantId}
            orders={open.data}
            isPending={open.isPending}
            emptyLabel="Nothing cooking. Every order is settled."
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <OrderList
            restaurantId={restaurantId}
            orders={history.data}
            isPending={history.isPending}
            emptyLabel="No completed orders yet."
          />
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

function OrderList({
  restaurantId,
  orders,
  isPending,
  emptyLabel,
}: {
  restaurantId: string;
  orders?: Order[];
  isPending: boolean;
  emptyLabel: string;
}) {
  const advance = useUpdateOrderStatus(restaurantId);
  const pay = usePayOrder(restaurantId);

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (!orders?.length) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">{emptyLabel}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {orders.map((order) => {
        const next = NEXT_STATUS[order.status];
        // Pay only once the food is out. The server enforces this too — settling a
        // PENDING order marks its lines served and drops the ticket off the kitchen's
        // list, so the customer pays for food nobody ever cooked.
        const canPay = order.status === "READY" || order.status === "SERVED";

        return (
          <Card key={order.id}>
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="flex min-w-40 flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{order.orderNumber}</span>
                  <Badge className={STATUS_STYLE[order.status]} variant="secondary">
                    {order.status.toLowerCase()}
                  </Badge>
                </div>
                <span className="text-muted-foreground text-xs">
                  {order.table ? `Table ${order.table.number}` : order.type.replace("_", " ").toLowerCase()}
                  {order.customer ? ` · ${order.customer.name}` : ""}
                </span>
              </div>

              <div className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                {order.orderItems
                  .map((line) => `${line.quantity}× ${line.menuItem.name}`)
                  .join(", ")}
              </div>

              <span className="tabular-nums">{inr.format(order.totalAmount)}</span>

              <div className="flex items-center gap-2">
                {next ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={advance.isPending}
                    onClick={() => advance.mutate({ id: order.id, status: next })}
                  >
                    {next.toLowerCase()}
                  </Button>
                ) : null}

                {canPay ? (
                  <Button
                    size="sm"
                    disabled={pay.isPending}
                    onClick={() => pay.mutate(order.id)}
                  >
                    Pay
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
