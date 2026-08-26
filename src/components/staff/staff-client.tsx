"use client";

import {
  AlertTriangle,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Plus,
  UserCheck,
  UserX,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ROLE_LABEL, StaffDialog } from "@/components/staff/staff-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

/** Initials for the roster avatar. A plain helper, not a hook — same split as
 *  elapsedLabel() below. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

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

  return (
    // data-density="touch" is law L15: the roster is tapped mid-service, on a floor
    // tablet, so every control in this subtree is lifted to --tap (44px, 46 in Forno)
    // by the scope in globals.css rather than by a per-button guess.
    <div data-density="touch" className="flex flex-1 flex-col gap-lg p-page">
      <div
        className="rise flex flex-wrap items-center gap-sm"
        style={{ "--i": 0 } as React.CSSProperties}
      >
        <Select value={filter} onValueChange={(v) => setFilter((v ?? "active") as RosterFilter)}>
          <SelectTrigger className="w-44" aria-label="Filter the roster">
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
          // shadow-brand is spent exactly once per screen, and this is that once.
          <Button className="ml-auto shadow-brand" onClick={() => openStaff()}>
            <Plus />
            Add staff
          </Button>
        ) : null}
      </div>

      {isError ? (
        <ErrorPanel message={error.message} />
      ) : (
        /* THE ROSTER — a card first, a table second. rounded-2xl is --r-lg, the step
           every palette annotates "THE CARD"; `shadow` is --sh, which resolves to
           nothing at all in Lievito, where a card is a rule. */
        <div
          className="rise overflow-hidden rounded-2xl border border-border bg-card shadow"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Shift</TableHead>
                <TableHead className="w-20">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isPending ? (
                Array.from({ length: 6 }).map((_, i) => <StaffRowSkeleton key={i} index={i} />)
              ) : staff?.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal">
                    <div className="flex flex-col items-center gap-sm px-card py-card text-center">
                      <div className="flex size-tap items-center justify-center rounded-2xl bg-brand-subtle text-brand-subtle-foreground">
                        <UsersRound className="size-5" aria-hidden />
                      </div>
                      <p className="font-heading text-h2 text-foreground">
                        {filter === "inactive"
                          ? "Nobody's been deactivated."
                          : "No staff on the roster yet."}
                      </p>
                      <p className="max-w-measure text-small text-muted-foreground">
                        {filter === "inactive"
                          ? "Everyone you've hired is still on the active roster."
                          : "Add the team and they can clock in and out from this table."}
                      </p>
                      {canManage && filter !== "inactive" ? (
                        <Button size="sm" variant="outline" onClick={() => openStaff()}>
                          <Plus />
                          Add the first one
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                staff?.map((member, i) => (
                  <StaffRow
                    key={member.id}
                    restaurantId={restaurantId}
                    staff={member}
                    canManage={canManage}
                    onEdit={openStaff}
                    index={Math.min(i, 12)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

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
  index,
}: {
  restaurantId: string;
  staff: Staff;
  canManage: boolean;
  onEdit: (staff: Staff) => void;
  index: number;
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
      <TableRow className="rise" style={{ "--i": index } as React.CSSProperties}>
        <TableCell>
          <div className="flex items-center gap-sm">
            <Avatar>
              <AvatarFallback className="bg-brand-subtle text-small font-semibold text-brand-subtle-foreground">
                {initials(staff.name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 truncate font-medium">{staff.name}</span>
          </div>
        </TableCell>

        <TableCell>
          <Badge variant="secondary">{ROLE_LABEL[staff.role]}</Badge>
        </TableCell>

        <TableCell className="text-small text-muted-foreground">
          <div className="flex flex-col gap-0.5">
            <span className="font-num tabular-nums">{staff.phone ?? "—"}</span>
            {staff.email ? <span className="truncate">{staff.email}</span> : null}
          </div>
        </TableCell>

        <TableCell>
          {/* The status is carried by the WORD first. The square dot and the wash are
              redundant with it, never a substitute — status is never colour alone. */}
          {staff.isActive ? (
            <Badge
              variant="secondary"
              className="bg-success-subtle text-success-subtle-foreground"
            >
              <span data-slot="badge-dot" aria-hidden />
              Active
            </Badge>
          ) : (
            <Badge variant="outline">
              <span data-slot="badge-dot" aria-hidden />
              Inactive
            </Badge>
          )}
        </TableCell>

        <TableCell className="text-right">
          {openShift ? (
            <div className="flex items-center justify-end gap-sm">
              <span className="hidden items-center gap-1.5 text-label tracking-label text-muted-foreground uppercase sm:inline-flex">
                <span aria-hidden className="size-1.5 rounded-hair bg-success" />
                On shift
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={clockOut.isPending}
                onClick={() => clockOut.mutate({ staffId: staff.id, shiftId: openShift.id })}
              >
                Clock out ·{" "}
                <span className="font-num tabular-nums">{elapsedLabel(openShift.startTime)}</span>
              </Button>
            </div>
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
          <div className="flex items-center justify-end gap-xs">
            <Button
              size="icon"
              variant="ghost"
              aria-label={historyOpen ? "Hide shift history" : "Show shift history"}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((o) => !o)}
            >
              <ChevronDown
                className={`transition-transform duration-(--dur) ease-quint ${historyOpen ? "rotate-180" : ""}`}
              />
            </Button>

            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${staff.name}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(staff)}>
                    <Pencil />
                    Edit
                  </DropdownMenuItem>
                  {staff.isActive ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => deactivate.mutate(staff.id)}
                    >
                      <UserX />
                      Deactivate
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => reactivate.mutate({ id: staff.id, isActive: true })}
                    >
                      <UserCheck />
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
          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/40 p-0 whitespace-normal">
            <div className="grid gap-xs p-card-sm">
              <h3 className="text-label tracking-label text-muted-foreground uppercase">
                Recent shifts
              </h3>
              {shiftsPending ? (
                <div className="grid gap-xs" aria-busy>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-tap-sm rounded-md" />
                  ))}
                </div>
              ) : shifts?.length ? (
                <ul className="grid gap-xs">
                  {shifts.map((shift, i) => (
                    <ShiftRow key={shift.id} shift={shift} index={i} />
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted-foreground">No shifts recorded yet.</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function ShiftRow({ shift, index }: { shift: Shift; index: number }) {
  const start = new Date(shift.startTime);
  const end = shift.endTime ? new Date(shift.endTime) : null;

  return (
    <li
      className="rise flex flex-wrap items-center justify-between gap-sm rounded-md border border-border bg-card px-3 py-2 text-small shadow-xs"
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className="min-w-0 font-num tabular-nums text-muted-foreground">
        {start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        {" → "}
        {end ? end.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "still clocked in"}
      </span>
      <span className="font-num font-semibold tabular-nums">
        {shift.hoursWorked != null ? `${shift.hoursWorked}h` : "—"}
      </span>
    </li>
  );
}

/** A skeleton shaped like the row it replaces — avatar disc, chip, two contact lines, a
 *  control — so nothing reflows when the roster lands. */
function StaffRowSkeleton({ index }: { index: number }) {
  return (
    <TableRow className="rise hover:bg-transparent" style={{ "--i": index } as React.CSSProperties}>
      <TableCell>
        <div className="flex items-center gap-sm">
          <Skeleton className="size-8 rounded-pill" />
          <Skeleton className="h-4 w-36" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-6 w-20 rounded-4xl" />
      </TableCell>
      <TableCell>
        <div className="grid gap-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-6 w-16 rounded-4xl" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-tap-sm w-28 rounded-ctl-sm" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-tap-sm w-20 rounded-md" />
      </TableCell>
    </TableRow>
  );
}

/** The failure surface. The -subtle triple (opaque wash, measured ink, opaque edge) is
 *  what the system designed for exactly this. The icon is redundant with the words. */
function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rise flex items-start gap-sm rounded-2xl border border-destructive-border bg-destructive-subtle p-card text-destructive-subtle-foreground shadow-xs"
      style={{ "--i": 1 } as React.CSSProperties}
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-heading text-h2">Couldn&apos;t load the roster.</p>
        <p className="mt-1 max-w-measure text-small wrap-break-word">{message}</p>
      </div>
    </div>
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
