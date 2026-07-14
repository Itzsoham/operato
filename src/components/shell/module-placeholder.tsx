import type { LucideIcon } from "lucide-react";

/**
 * Temporary. Each of these routes is replaced by its real module (steps 4-7); this
 * exists so the sidebar never links to a 404, and so it is obvious at a glance what is
 * built and what is not. Delete a copy as each module lands.
 */
export function ModulePlaceholder({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </div>
        <h2 className="font-medium">{title}</h2>
        <p className="text-muted-foreground text-sm text-balance">{description}</p>
      </div>
    </div>
  );
}
