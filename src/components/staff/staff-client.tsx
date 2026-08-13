"use client";

import { ChevronDown, MoreHorizontal, Pencil, Plus, UserCheck, UserX, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";

import { ROLE_LABEL, StaffDialog } from "@/components/staff/staff-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  useClockIn,
  useClockOut,
  useDeactivateStaff,
  useShifts,
  useStaff,
  useUpdateStaff,
  type Shift,
  type Staff,
} from "@/hooks/use-staff";

type RosterFilter = "active" | "inactive" | "all";

const FILTER_LABEL: Record<RosterFilter, string> = {
  active: "Active roster",
  inactive: "Inactive",
  all: "Everyone",
};

const COLUMN_COUNT = 6;

export function StaffClient({
  restaurantId,
  canManage,
}: {
  restaurantId: string;
  /** Hiring, editing pay, and deactivating someone — a manager's decision, same split
   *  Inventory draws for its own catalogue. Clocking in/out is deliberately NOT gated by
   *  this — see the shifts routes. */
  canManage: boolean;
}) {
  const [filter, setFilter] = useState<RosterFilter>("active");
  const [active, setActive] = useState<Staff | undefined>();
  const [open, setOpen] = useState(false);

  const { data: staff, isPending, isError, error } = useStaff(restaurantId, {
    active: filter === "all" ? undefined : filter === "active",
  });

  function openStaff(member?: Staff) {
    setActive(member);
    setOpen(true);
  }

  if (isError) {
    return (
      <p className="text-destructive p-6 text-sm">Couldn&apos;t load the roster: {error.message}</p>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={(v) => setFilter((v ?? "active") as RosterFilter)}>
          <SelectTrigger className="w-44">
            {/* Base UI's SelectValue renders the RAW VALUE unless you give it a render
                function — it would show "active", not "Active roster". */}
            <SelectValue>{(value) => FILTER_LABEL[value as RosterFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FILTER_LABEL) as RosterFilter[]).map((key) => (
              <SelectItem key={key} value={key}>
                {FILTER_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canManage ? (
          <Button className="ml-auto" onClick={() => openStaff()}>
            <Plus className="size-4" />
            Add staff
          </Button>
        ) : null}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Shift</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {isPending ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={COLUMN_COUNT}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : staff?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT}>
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-lg">
                      <UsersRound className="size-5" />
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {filter === "inactive" ? "Nobody's been deactivated." : "No staff on the roster yet."}
                    </p>
                    {canManage && filter !== "inactive" ? (
                      <Button size="sm" variant="outline" onClick={() => openStaff()}>
                        Add the first one
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              staff?.map((member) => (
                <StaffRow
                  key={member.id}
                  restaurantId={restaurantId}
                  staff={member}
                  canManage={canManage}
                  onEdit={openStaff}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <StaffDialog restaurantId={restaurantId} staff={active} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * One roster row. Its own component, not inlined in the `.map()` above, because it needs
 * its own `useShifts` call — the roster endpoint doesn't carry each member's open shift
 * (see the note on useShifts), so every row asks for its own attendance history. That
 * same fetch doubles as the expandable "recent shifts" panel below, so opening it costs no
 * extra request.
 */
function StaffRow({
  restaurantId,
  staff,
  canManage,
  onEdit,
}: {
  restaurantId: string;
  staff: Staff;
  canManage: boolean;
  onEdit: (staff: Staff) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: shifts, isPending: shiftsPending } = useShifts(restaurantId, staff.id, {
    limit: 5,
  });
  const clockIn = useClockIn(restaurantId);
  const clockOut = useClockOut(restaurantId);
  const deactivate = useDeactivateStaff(restaurantId);
  const reactivate = useUpdateStaff(restaurantId);

  // The service orders shifts newest-first, so the open one — if there is one — is always
  // the first row. A staff member can only ever have one open shift at a time (the
  // service's row lock refuses a second), so checking just the head is enough.
  const openShift = shifts?.[0]?.endTime == null ? shifts?.[0] : undefined;

  // A once-a-minute tick so an open shift's "Clock out · 1h 24m" doesn't quietly go stale
  // while the row sits on screen — elapsedLabel() below is what actually reads the clock,
  // same "plain helper, not a hook" split as sinceLabel() in customers-client.tsx, so
  // nothing here calls Date.now() from inside a hook body.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!openShift) return;
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [openShift]);

  return (
    <>
      <TableRow>
        <TableCell>
          <span className="font-medium">{staff.name}</span>
        </TableCell>

        <TableCell>
          <Badge variant="secondary">{ROLE_LABEL[staff.role]}</Badge>
        </TableCell>

        <TableCell className="text-muted-foreground text-sm">
          <div className="flex flex-col">
            <span>{staff.phone ?? "—"}</span>
            {staff.email ? <span className="text-xs">{staff.email}</span> : null}
          </div>
        </TableCell>

        <TableCell>
          {staff.isActive ? (
            <Badge
              variant="secondary"
              className="bg-success-subtle text-success-subtle-foreground"
            >
              Active
            </Badge>
          ) : (
            <Badge variant="secondary">Inactive</Badge>
          )}
        </TableCell>

        <TableCell className="text-right">
          {openShift ? (
            <Button
              size="sm"
              variant="outline"
              disabled={clockOut.isPending}
              onClick={() => clockOut.mutate({ staffId: staff.id, shiftId: openShift.id })}
            >
              Clock out · {elapsedLabel(openShift.startTime)}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={clockIn.isPending || !staff.isActive}
              title={!staff.isActive ? "Reactivate before clocking in" : undefined}
              onClick={() => clockIn.mutate({ staffId: staff.id })}
            >
              Clock in
            </Button>
          )}
        </TableCell>

        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={historyOpen ? "Hide shift history" : "Show shift history"}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((o) => !o)}
            >
              <ChevronDown className={`size-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            </Button>

            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Actions for ${staff.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(staff)}>
                    <Pencil className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  {staff.isActive ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => deactivate.mutate(staff.id)}
                    >
                      <UserX className="size-4" />
                      Deactivate
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => reactivate.mutate({ id: staff.id, isActive: true })}
                    >
                      <UserCheck className="size-4" />
                      Reactivate
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </TableCell>
      </TableRow>

      {historyOpen ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/30 whitespace-normal p-0">
            <div className="p-4">
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                Recent shifts
              </p>
              {shiftsPending ? (
                <Skeleton className="h-6 w-full" />
              ) : shifts?.length ? (
                <ul className="space-y-1.5">
                  {shifts.map((shift) => (
                    <ShiftRow key={shift.id} shift={shift} />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No shifts recorded yet.</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function ShiftRow({ shift }: { shift: Shift }) {
  const start = new Date(shift.startTime);
  const end = shift.endTime ? new Date(shift.endTime) : null;

  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        {start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        {" → "}
        {end ? end.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "still clocked in"}
      </span>
      <span className="tabular-nums">
        {shift.hoursWorked != null ? `${shift.hoursWorked}h` : "—"}
      </span>
    </li>
  );
}

/**
 * "1h 24m" since `startTimeIso`. A plain function, not a hook — same split as
 * `sinceLabel` in customers-client.tsx — so the `Date.now()` read lives outside any hook
 * body; StaffRow's own once-a-minute `tick` state is what makes calling this again
 * actually produce a new string.
 */
function elapsedLabel(startTimeIso: string): string {
  const totalMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(startTimeIso).getTime()) / 60_000),
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

