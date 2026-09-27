import clsx from "clsx";

/**
 * Small pulsing dot for "this is live right now" state (a running timer, the
 * current-time marker on the calendar) — inherits color from `text-*` on an
 * ancestor via `currentColor`, so it drops into any tone without its own prop.
 */
export function LiveDot({ className }: { className?: string }): React.ReactElement {
  return (
    <span className={clsx("relative inline-flex h-2 w-2 shrink-0", className)}>
      <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-75" />
      <span className="relative h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
