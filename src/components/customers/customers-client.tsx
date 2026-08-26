"use client";

import { AlertTriangle, Plus, Search, Users } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { CustomerDialog } from "@/components/customers/customer-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCustomers, type Customer, type CustomerSort } from "@/hooks/use-customers";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const SORT_LABEL: Record<CustomerSort, string> = {
  spend: "Top spenders",
  recent: "Most recent visit",
  name: "Name",
};

const COLUMN_COUNT = 5;

function sinceLabel(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Initials for the CRM avatar. A plain helper, not a hook — same split as sinceLabel().
 * The avatar is a ROUNDED-PILL disc (Avatar's own radius token), which is how Crema and
 * Forno read it; Lievito pins --r-pill to 3px on purpose, so the same markup squares off
 * there without this file knowing anything about it.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

export function CustomersClient({ restaurantId }: { restaurantId: string }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CustomerSort>("spend");
  const [active, setActive] = useState<Customer | undefined>();
  const [open, setOpen] = useState(false);

  // The SERVER filters and sorts. With thousands of customers, doing it in the browser
  // would mean shipping the whole table to sort five rows.
  const deferredSearch = useDeferredValue(search.trim());
  const { data: customers, isPending, isError, error } = useCustomers(restaurantId, {
    search: deferredSearch || undefined,
    sort,
  });

  function openCustomer(customer?: Customer) {
    setActive(customer);
    setOpen(true);
  }

  return (
    <div className="flex flex-1 flex-col gap-lg p-page">
      {/* THE TOOLBAR — the mockups' .sec__head: filters left, the one CTA right.
          shadow-brand is spent exactly once per screen, and this is that once. */}
      <div
        className="rise flex flex-wrap items-center gap-sm"
        style={{ "--i": 0 } as React.CSSProperties}
      >
        <div className="relative w-full max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or number…"
            aria-label="Search customers"
            className="pl-10"
          />
        </div>

        <Select value={sort} onValueChange={(v) => setSort((v ?? "spend") as CustomerSort)}>
          <SelectTrigger className="w-44" aria-label="Sort customers">
            {/* Base UI's SelectValue renders the RAW VALUE unless you give it a render
                function — it would show "spend", not "Top spenders". */}
            <SelectValue>{(value) => SORT_LABEL[value as CustomerSort]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as CustomerSort[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button className="ml-auto shadow-brand" onClick={() => openCustomer()}>
          <Plus />
          Add customer
        </Button>
      </div>

      {isError ? (
        <ErrorPanel message={error.message} />
      ) : (
        /* THE LEDGER — a card first, a table second. rounded-2xl is --r-lg ("THE CARD"
           in every palette: 16px Crema, 30px Forno, 3px Lievito, 10px Saffron) and
           `shadow` is --sh, which is literally nothing in Lievito, where a card is a
           rule and not a raft. */
        <div
          className="rise overflow-hidden rounded-2xl border border-border bg-card shadow"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Lifetime spend</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isPending ? (
                Array.from({ length: 8 }).map((_, i) => <CustomerRowSkeleton key={i} index={i} />)
              ) : customers?.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal">
                    <div className="flex flex-col items-center gap-sm px-card py-card text-center">
                      <div className="flex size-tap items-center justify-center rounded-2xl bg-brand-subtle text-brand-subtle-foreground">
                        <Users className="size-5" aria-hidden />
                      </div>
                      <p className="font-heading text-h2 text-foreground">
                        {search ? "Nobody matches that." : "No customers yet."}
                      </p>
                      <p className="max-w-measure text-small text-muted-foreground">
                        {search
                          ? "Try a different name, or the last four digits of the number."
                          : "A customer is created the first time you attach a phone number to an order — or add one here."}
                      </p>
                      {search ? null : (
                        <Button variant="outline" size="sm" onClick={() => openCustomer()}>
                          <Plus />
                          Add the first one
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers?.map((customer, i) => (
                  <TableRow
                    key={customer.id}
                    className="rise cursor-pointer"
                    style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
                    tabIndex={0}
                    aria-label={`Open ${customer.name}`}
                    onClick={() => openCustomer(customer)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openCustomer(customer);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-sm">
                        <Avatar>
                          <AvatarFallback className="bg-brand-subtle text-small font-semibold text-brand-subtle-foreground">
                            {initials(customer.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 truncate font-medium">{customer.name}</span>
                        {customer.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>

                    <TableCell className="font-num text-small tabular-nums text-muted-foreground">
                      {customer.phone ?? "—"}
                    </TableCell>

                    <TableCell className="text-right font-num font-semibold tabular-nums">
                      {inr.format(customer.totalSpend)}
                    </TableCell>

                    <TableCell className="text-right font-num tabular-nums">
                      {customer.visitCount}
                    </TableCell>

                    <TableCell className="text-right text-small text-muted-foreground">
                      {sinceLabel(customer.lastVisitAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <CustomerDialog
        restaurantId={restaurantId}
        customer={active}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

/** A skeleton shaped like the row it replaces — an avatar disc and five columns — so
 *  nothing reflows when the data lands. */
function CustomerRowSkeleton({ index }: { index: number }) {
  return (
    <TableRow className="rise hover:bg-transparent" style={{ "--i": index } as React.CSSProperties}>
      <TableCell>
        <div className="flex items-center gap-sm">
          <Skeleton className="size-8 rounded-pill" />
          <Skeleton className="h-4 w-40" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-4 w-8" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-4 w-16" />
      </TableCell>
    </TableRow>
  );
}

/** The failure surface. The -subtle triple (opaque wash, measured ink, opaque edge) is
 *  the pair the system designed for exactly this — never destructive/10 over an unknown
 *  ground. The icon is redundant with the words, never a substitute for them. */
function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rise flex items-start gap-sm rounded-2xl border border-destructive-border bg-destructive-subtle p-card text-destructive-subtle-foreground shadow-xs"
      style={{ "--i": 1 } as React.CSSProperties}
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-heading text-h2">Couldn&apos;t load the customer list.</p>
        <p className="mt-1 max-w-measure text-small wrap-break-word">{message}</p>
      </div>
    </div>
  );
}
