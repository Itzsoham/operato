"use client";

import { ChefHat, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { MenuItemDialog } from "@/components/menu/menu-item-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useDeleteMenuItem,
  useMenuItems,
  useUpdateMenuItem,
  type MenuItem,
} from "@/hooks/use-menu";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function MenuClient({ restaurantId }: { restaurantId: string }) {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | undefined>();

  // The SERVER does the filtering, and the filter is part of the query key. Filtering
  // client-side would have meant the whole menu is always fetched — fine for 17 dishes,
  // wrong for the thousands of orders the next module lists. useDeferredValue keeps the
  // input responsive without firing a request per keystroke.
  const deferredSearch = useDeferredValue(search.trim());
  const filters = deferredSearch ? { search: deferredSearch } : undefined;

  const { data: items, isPending, isError, error } = useMenuItems(restaurantId, filters);
  const update = useUpdateMenuItem(restaurantId);
  const remove = useDeleteMenuItem(restaurantId);

  const visible = items;

  function openCreate() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(item: MenuItem) {
    setEditing(item);
    setDialogOpen(true);
  }

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-destructive text-sm">
          Couldn&apos;t load the menu: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search dishes…"
          className="max-w-xs"
        />
        <Button className="ml-auto" onClick={openCreate}>
          <Plus className="size-4" />
          Add item
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="w-28">Available</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {isPending ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : visible?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-lg">
                      <ChefHat className="size-5" />
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {search ? "No dishes match that search." : "No dishes yet."}
                    </p>
                    {!search ? (
                      <Button size="sm" variant="outline" onClick={openCreate}>
                        Add the first one
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              visible?.map((item) => (
                <TableRow key={item.id} className={item.isAvailable ? "" : "opacity-60"}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        aria-label={item.isVeg ? "Vegetarian" : "Non-vegetarian"}
                        title={item.isVeg ? "Vegetarian" : "Non-vegetarian"}
                        className={`size-2.5 shrink-0 rounded-full border ${
                          item.isVeg ? "border-green-600 bg-green-600" : "border-red-600 bg-red-600"
                        }`}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">{item.name}</span>
                        {item.description ? (
                          <span className="text-muted-foreground line-clamp-1 text-xs">
                            {item.description}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    {item.category ? (
                      <Badge variant="secondary">{item.category.name}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>

                  <TableCell className="text-right tabular-nums">
                    {inr.format(item.price)}
                  </TableCell>

                  <TableCell>
                    <Switch
                      checked={item.isAvailable}
                      aria-label={`${item.name} available`}
                      // Optimistic — see useUpdateMenuItem. The toggle flips instantly and
                      // rolls back if the server refuses.
                      onCheckedChange={(isAvailable) =>
                        update.mutate({ id: item.id, isAvailable })
                      }
                    />
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Actions for ${item.name}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(item)}>
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => remove.mutate(item.id)}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <MenuItemDialog
        restaurantId={restaurantId}
        item={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
