import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // THE JAR LABEL. min-height 26px, 4px/9px pad, --r-2xl, uppercase --t-chip at
  // --label-tracking, and a 6px square status dot's worth of gap in front of the
  // text. rounded-4xl is --r-2xl, the rung every palette annotates ".chip /
  // Badge" and deliberately breaks the ladder for: 6px Crema (never a pill —
  // the pill is reserved for the masthead eyebrow), 44px Forno (a capsule, by
  // contrast), 2px Lievito and 2px Saffron (a chip is a control, so it squares
  // off). rounded-pill would have flattened three of those four into 999px.
  // Any child carrying data-slot="badge-dot" is rendered as that 6px square.
  "group/badge inline-flex min-h-6.5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-4xl border border-transparent px-2.5 py-1 text-chip tracking-label uppercase whitespace-nowrap transition-all duration-(--dur) ease-quint focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3! [&>[data-slot=badge-dot]]:size-1.5 [&>[data-slot=badge-dot]]:shrink-0 [&>[data-slot=badge-dot]]:rounded-hair [&>[data-slot=badge-dot]]:bg-current [&>[data-slot=badge-dot]]:opacity-80",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        // The -subtle triple is the pair the system designed FOR chips: an
        // opaque wash, a text colour measured >=5.5:1 on it, and a decorative
        // opaque edge. destructive/10 was an alpha guess over an unknown ground.
        destructive:
          "border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
