"use client";

import { useState } from "react";

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
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateCustomer,
  useCustomer,
  useUpdateCustomer,
  type Customer,
  type CustomerDetail,
} from "@/hooks/use-customers";
import { createCustomerSchema } from "@/lib/validations/customers";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

type FieldErrors = Partial<Record<string, string>>;

export function CustomerDialog({
  restaurantId,
  customer,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  /** Present = edit an existing customer (and show their order history). */
  customer?: Customer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{customer ? customer.name : "Add customer"}</DialogTitle>
          <DialogDescription>
            {customer
              ? `${inr.format(customer.totalSpend)} across ${customer.visitCount} visit${customer.visitCount === 1 ? "" : "s"}`
              : "A phone number is required — see below."}
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <CustomerBody
            key={customer?.id ?? "new"}
            restaurantId={restaurantId}
            customer={customer}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The LIST endpoint deliberately does not return `email` — a tenant's customer email
 * addresses have no business being shipped to a browser that renders five columns, none
 * of which is email. So editing waits for the DETAIL fetch, which does carry it.
 *
 * Rendering the form early with an empty email box would be worse than a brief skeleton:
 * the field is uncontrolled, so a value arriving late would never appear — and saving
 * would silently blank out an address the customer actually has.
 */
function CustomerBody({
  restaurantId,
  customer,
  onDone,
}: {
  restaurantId: string;
  customer?: Customer;
  onDone: () => void;
}) {
  const detail = useCustomer(restaurantId, customer?.id);

  if (customer && detail.isPending) {
    return (
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  }

  return (
    <CustomerForm
      restaurantId={restaurantId}
      customer={customer}
      detail={detail.data}
      onDone={onDone}
    />
  );
}

function CustomerForm({
  restaurantId,
  customer,
  detail,
  onDone,
}: {
  restaurantId: string;
  customer?: Customer;
  detail?: CustomerDetail;
  onDone: () => void;
}) {
  const create = useCreateCustomer(restaurantId);
  const update = useUpdateCustomer(restaurantId);

  const [errors, setErrors] = useState<FieldErrors>({});
  const pending = create.isPending || update.isPending;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = new FormData(event.currentTarget);
    // The SAME schema the route uses. This copy saves a round trip; the server's copy is
    // the control.
    const parsed = createCustomerSchema.safeParse({
      name: form.get("name"),
      phone: form.get("phone"),
      email: String(form.get("email") ?? "").trim() || null,
    });

    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".") || "form"] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    if (customer) update.mutate({ id: customer.id, ...parsed.data }, { onSuccess: onDone });
    else create.mutate(parsed.data, { onSuccess: onDone });
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            defaultValue={customer?.name}
            placeholder="Meera Gupta"
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name ? <p className="text-destructive text-sm">{errors.name}</p> : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={customer?.phone ?? ""}
            placeholder="+91 98765 43210"
            aria-invalid={Boolean(errors.phone)}
          />
          {errors.phone ? (
            <p className="text-destructive text-sm">{errors.phone}</p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Required — it&apos;s how a returning customer is recognised. An order without
              one simply isn&apos;t attributed to anybody.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={detail?.email ?? ""}
            placeholder="Optional"
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? <p className="text-destructive text-sm">{errors.email}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : customer ? "Save changes" : "Add customer"}
          </Button>
        </DialogFooter>
      </form>

      {customer ? (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-medium">
            Recent orders — what the lifetime spend is made of
          </p>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {/* CustomerBody already waited for this fetch — see the note there. */}
            {detail?.orders.length ? (
              detail.orders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <Badge variant="secondary">{order.orderNumber}</Badge>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                    {order.orderItems
                      .map((line) => `${line.quantity}× ${line.menuItem.name}`)
                      .join(", ")}
                  </span>
                  <span className="tabular-nums">{inr.format(order.totalAmount)}</span>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground py-4 text-center text-sm">
                No paid orders yet.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
