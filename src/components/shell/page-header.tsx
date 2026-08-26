/**
 * THE PAGE HEADER — the mockups' MASTHEAD, and the one thing on a screen that says where
 * you are.
 *
 * It is a full-bleed band across the top of the main column, painted with --grad-hero:
 * the wash every palette declares for exactly this ("THE MASTHEAD WASH", globals.css §1)
 * and that nothing consumed until now. Crema's oat -> cream -> chalk, Forno's ember
 * mouth, Lievito's flat paper, Saffron's candlelit card — one element, four directions.
 *
 * The chrome it used to carry — the sidebar trigger and the palette switcher — moved up
 * into AppTopBar, which the tenant layout mounts once. A page can no longer forget to
 * render the only control that opens the navigation.
 *
 * Props and test hooks are unchanged: `title`, `description`, `actions`, and the
 * page-title / page-description testids the E2E suite navigates by.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header
      data-slot="page-header"
      className="border-b border-border bg-[image:var(--grad-hero)]"
    >
      {/* The BAND bleeds edge to edge; its copy sits on --pad-page, the same gutter the
          page content below uses, so the title and the first card share a left edge.
          The description is held to --measure because a 1900px-wide sentence is not a
          sentence. */}
      <div className="flex flex-wrap items-end justify-between gap-lg px-page py-lg">
        <div className="min-w-0 flex-1">
          <h1
            className="rise truncate font-heading text-h1 text-foreground"
            style={{ "--i": 0 } as React.CSSProperties}
            data-testid="page-title"
          >
            {title}
          </h1>
          {description ? (
            <p
              className="rise mt-2 max-w-measure text-body text-muted-foreground"
              style={{ "--i": 1 } as React.CSSProperties}
              data-testid="page-description"
            >
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div
            className="rise flex shrink-0 flex-wrap items-center gap-sm"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
