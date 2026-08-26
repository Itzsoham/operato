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

const since = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

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
              ? `Customer since ${since.format(new Date(customer.createdAt))}`
              : "A phone number is required — see below."}
          </DialogDescription>
        </DialogHeader>

        {/* THE TWO FIGURES THIS SCREEN EXISTS FOR. --text-metric is the KPI step, and
            it is the one place in a CRM record that earns it — always paired with
            font-num + tabular-nums, because "₹4,86,300" is lakh-grouped and must not
            jitter as it re-renders. */}
        {customer ? (
          <dl className="grid grid-cols-2 gap-xs">
            <div className="rounded-xl border border-border bg-muted/40 p-card-sm">
              <dt className="text-label tracking-label text-muted-foreground uppercase">
                Lifetime spend
              </dt>
              <dd className="mt-1 truncate font-num text-metric tabular-nums text-foreground">
                {inr.format(customer.totalSpend)}
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-card-sm">
              <dt className="text-label tracking-label text-muted-foreground uppercase">
                Visits
              </dt>
              <dd className="mt-1 truncate font-num text-metric tabular-nums text-foreground">
                {customer.visitCount}
              </dd>
            </div>
          </dl>
        ) : null}

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
    // Shaped like the form it stands in for: a label rule over a --tap-tall control,
    // three times, so nothing jumps when the detail lands.
    return (
      <div className="grid gap-sm" aria-busy>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="grid gap-xs">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-tap rounded-lg" />
          </div>
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
    <form onSubmit={onSubmit} className="grid gap-sm" noValidate>
      <div className="grid gap-xs">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={customer?.name}
          placeholder="Meera Gupta"
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name ? <p className="text-small text-destructive">{errors.name}</p> : null}
      </div>

      <div className="grid gap-xs">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          defaultValue={customer?.phone ?? ""}
          placeholder="+91 98765 43210"
          aria-invalid={Boolean(errors.phone)}
        />
        {errors.phone ? (
          <p className="text-small text-destructive">{errors.phone}</p>
        ) : (
          <p className="max-w-measure text-small text-muted-foreground">
            Required — it&apos;s how a returning customer is recognised. An order without
            one simply isn&apos;t attributed to anybody.
          </p>
        )}
      </div>

      <div className="grid gap-xs">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={detail?.email ?? ""}
          placeholder="Optional"
          aria-invalid={Boolean(errors.email)}
        />
        {errors.email ? <p className="text-small text-destructive">{errors.email}</p> : null}
      </div>

      {/* The history sits INSIDE the form and above the footer on purpose: DialogFooter
          bleeds itself back out of the dialog's own p-card with -mx-card/-mb-card, so it
          has to be the last thing in the popup or the bleed lands mid-panel. */}
      {customer ? (
        <section className="grid gap-xs">
          <h3 className="text-label tracking-label text-muted-foreground uppercase">
            Recent orders
          </h3>
          <p className="text-small text-muted-foreground">
            What the lifetime spend is made of.
          </p>
          <div className="max-h-48 space-y-xs overflow-y-auto">
            {/* CustomerBody already waited for this fetch — see the note there. */}
            {detail?.orders.length ? (
              detail.orders.map((order, i) => (
                <div
                  key={order.id}
                  className="rise flex items-center gap-sm rounded-md border border-border bg-card px-3 py-2 text-small shadow-xs"
                  style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
                >
                  <Badge variant="secondary" className="font-num">
                    {order.orderNumber}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {order.orderItems
                      .map((line) => `${line.quantity}× ${line.menuItem.name}`)
                      .join(", ")}
                  </span>
                  <span className="font-num font-semibold tabular-nums">
                    {inr.format(order.totalAmount)}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-small text-muted-foreground">
                No paid orders yet.
              </p>
            )}
          </div>
        </section>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" className="shadow-brand" disabled={pending}>
          {pending ? "Saving…" : customer ? "Save changes" : "Add customer"}
        </Button>
      </DialogFooter>
    </form>
  );
}
