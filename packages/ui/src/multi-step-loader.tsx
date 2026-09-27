"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { Spinner } from "./primitives";

/**
 * A vertical sequence of step labels that advances on a timer while the
 * caller's operation is in flight. ORION's backup/restore (the only user of
 * this so far) is a single black-box HTTP request — the server never reports
 * progress mid-request — so this is *not* real server-pushed progress. What
 * keeps it honest: the labels mirror the real, known phases of that request
 * (see `SyncService.backup`/`restore`), and the loader never advances past
 * the last step or claims "done" on its own — it just sits there, spinner on
 * the last label, until the caller's mutation actually settles and unmounts
 * this. No separate `active` prop: mount when the operation starts, unmount
 * when it ends — the component's lifecycle *is* the signal.
 *
 * Same connector visual as the version-history timeline
 * (`document-history.tsx`/`note-history.tsx`) — line + dot per row — reusing
 * the identical offsets for consistency between the two.
 */
export function MultiStepLoader({
  steps,
  stepDuration = 900,
  className
}: {
  steps: string[];
  stepDuration?: number;
  className?: string;
}): React.ReactElement {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (index >= steps.length - 1) return;
    const timer = setTimeout(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), stepDuration);
    return () => clearTimeout(timer);
  }, [index, steps.length, stepDuration]);

  return (
    <div className={clsx("relative space-y-1.5 rounded-lg border border-border bg-card/60 p-3 pl-8", className)}>
      <div className="absolute bottom-3 left-[26px] top-3 w-px bg-border" aria-hidden />
      {steps.map((label, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <div key={label} className="relative flex items-center gap-1.5 text-xs">
            <span
              className={clsx(
                "absolute -left-[15px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 transition-colors",
                done ? "border-success bg-success" : current ? "border-accent bg-accent" : "border-border-strong bg-background"
              )}
              aria-hidden
            />
            <span className={done ? "text-muted-foreground" : current ? "font-medium text-foreground" : "text-subtle-foreground"}>
              {label}
            </span>
            {current ? <Spinner className="h-3 w-3" /> : null}
          </div>
        );
      })}
    </div>
  );
}
