import type { OrderStatus } from "@/generated/prisma/enums";

import { cn } from "@/lib/utils";

/**
 * An order's state is a POSITION IN A SEQUENCE, not a category — so it is encoded
 * twice: by colour and by a five-step meter. That redundancy is the point. A kitchen
 * screen is read at arm's length, through glare, sometimes by someone who is
 * colour-blind; any one of those defeats colour alone.
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
  PREPARING: "bg-warning-subtle text-warning-subtle-foreground border-warning-border",
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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1.5",
        "text-[10.5px] leading-none font-bold whitespace-nowrap",
        TONE[status],
        className,
      )}
    >
      {filled > 0 && (
        /* Decorative: the adjacent text already names the state, so the meter is
           hidden from assistive tech rather than read out as five list items. */
        <span aria-hidden className="flex gap-[2px]">
          {[1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={cn(
                "h-[9px] w-[3px] rounded-[1px] bg-current",
                i <= filled ? "opacity-100" : "opacity-25",
              )}
            />
          ))}
        </span>
      )}
      {LABEL[status]}
    </span>
  );
}
