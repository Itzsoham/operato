"use client";

import { Plus, Users } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { CustomerDialog } from "@/components/customers/customer-dialog";
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

function sinceLabel(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function CustomersClient({ restaurantId }: { restaurantId: string }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CustomerSort>("spend");
  const [active, setActive] = useState<Customer | undefined>();
  const [open, setOpen] = useState(false);

  // The SERVER filters and sorts. With thousands of customers, doing it in the browser
  // would mean shipping the whole table to sort five rows.
  const deferredSearch = useDeferredValue(search.trim());
  const { data: customers, isPending } = useCustomers(restaurantId, {
    search: deferredSearch || undefined,
    sort,
  });

  function openCustomer(customer?: Customer) {
    setActive(customer);
    setOpen(true);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or number…"
          className="max-w-xs"
        />

        <Select value={sort} onValueChange={(v) => setSort((v ?? "spend") as CustomerSort)}>
          <SelectTrigger className="w-44">
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

        <Button className="ml-auto" onClick={() => openCustomer()}>
          <Plus className="size-4" />
          Add customer
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Lifetime spend</TableHead>
              <TableHead className="text-right">Visits</TableHead>
              <TableHead className="text-right">Last seen</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {isPending ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : customers?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-lg">
                      <Users className="size-5" />
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {search ? "Nobody matches that." : "No customers yet."}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              customers?.map((customer) => (
                <TableRow
                  key={customer.id}
                  className="cursor-pointer"
                  onClick={() => openCustomer(customer)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{customer.name}</span>
                      {customer.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>

                  <TableCell className="text-muted-foreground tabular-nums">
                    {customer.phone ?? "—"}
                  </TableCell>

                  <TableCell className="text-right font-medium tabular-nums">
                    {inr.format(customer.totalSpend)}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {customer.visitCount}
                  </TableCell>

                  <TableCell className="text-muted-foreground text-right text-sm">
                    {sinceLabel(customer.lastVisitAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CustomerDialog
        restaurantId={restaurantId}
        customer={active}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
