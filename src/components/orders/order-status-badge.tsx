import type { OrderStatus } from "@/generated/prisma/enums";

import { cn } from "@/lib/utils";

/**
 * An order's state is a POSITION IN A SEQUENCE, not a category — so it is encoded
 * FOUR times, and that redundancy is the point. A kitchen screen is read at arm's
 * length, through glare, sometimes by someone who is colour-blind; any one of those
 * defeats colour alone.
 *
 *   1. HUE          — the -subtle pair for the state (cool → warm → gold → sage → mute).
 *   2. THE METER    — five segments, `filled` of them lit. Bars are 6px wide with a
 *                     4px gap: the old 3px/2px meter is below acuity past about a
 *                     metre, which is exactly the distance a pass is read from.
 *   3. FILL WEIGHT  — the unlit segments are drawn at a fifth of the ink, so the
 *                     boundary is a WEIGHT change and not only a colour change; and
 *                     the chip itself steps from a wash to a solid fill at READY.
 *   4. THE LABEL    — the word. The only one of the four a screen reader gets, which
 *                     is why the meter is aria-hidden rather than five list items.
 *
 * The ramp reads as rising then resolving heat:
 *   Placed (cool, nothing owed yet) → Preparing (in the fire) → Ready (loudest thing
 *   on the screen; food is going cold) → Served (resolved, money outstanding) →
 *   Paid (deliberately quiet, so closed rows recede on a busy night).
 *
 * Ready is the only SOLID-FILLED chip in the system. Nothing else competes with it.
 */
const STEP: Record<OrderStatus, number> = {
  PENDING: 1,
  CONFIRMED: 1,
  PREPARING: 2,
  READY: 3,
  SERVED: 4,
  PAID: 5,
  CANCELLED: 0,
};

const TONE: Record<OrderStatus, string> = {
  PENDING: "bg-info-subtle text-info-subtle-foreground border-info/25",
  CONFIRMED: "bg-info-subtle text-info-subtle-foreground border-info/25",
  PREPARING:
    "bg-warning-subtle text-warning-subtle-foreground border-warning-border",
  READY: "bg-ready text-ready-foreground border-ready-foreground/25",
  SERVED: "bg-success-subtle text-success-subtle-foreground border-success/25",
  PAID: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-muted text-muted-foreground border-border line-through",
};

const LABEL: Record<OrderStatus, string> = {
  PENDING: "Placed",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const filled = STEP[status];

  return (
    <span
      /* Keyed on the status so an advance REMOUNTS the chip and replays
         --animate-step-advance. That motion is the one in the system that carries
         meaning, and it is still redundant: the meter, the fill and the word all
         change with it. Reduced motion collapses it to nothing (globals.css). */
      key={status}
      data-status={status}
      className={cn(
        // rounded-4xl is --r-2xl, the rung every palette annotates "the chip" and
        // deliberately breaks its own ladder for: 6px Crema, 44px Forno (a capsule,
        // by contrast), 2px Lievito and 2px Saffron. rounded-pill would have
        // flattened three of those four into 999px.
        "inline-flex animate-step-advance items-center gap-xs rounded-4xl border py-1 pr-2.5 pl-2",
        "text-chip tracking-label whitespace-nowrap uppercase",
        TONE[status],
        className,
      )}
    >
      {filled > 0 && (
        /* Decorative: the adjacent text already names the state, so the meter is
           hidden from assistive tech rather than read out as five list items. */
        <span aria-hidden className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={cn(
                "h-2.5 w-1.5 rounded-hair bg-current",
                i <= filled ? "opacity-100" : "opacity-20",
              )}
            />
          ))}
        </span>
      )}
      {LABEL[status]}
    </span>
  );
}
