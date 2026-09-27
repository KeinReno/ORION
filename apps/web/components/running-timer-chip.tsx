"use client";

import { useRunningTimer } from "@orion/core-react";
import { entryMinutes, formatDuration } from "@orion/shared-types";
import { LiveDot } from "@orion/ui";
import { useNowTick } from "../panels/time/use-now";
import { openPanel } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";

/**
 * A running timer is a fact about the whole app, not about one panel — this
 * chip keeps it visible (and ticking) from anywhere, the way a stopwatch would.
 *
 * It shares the live-timer mechanism with `TimerWidget`: `useRunningTimer`
 * asks the server once a minute *whether* a timer runs, and `useNowTick`
 * re-renders this chip every second to recompute the duration locally. No
 * per-second requests, and nothing is rendered at all when no timer runs.
 */
export function RunningTimerChip(): React.ReactElement | null {
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const { data: running } = useRunningTimer(isEnabled("time") ? workspace?.id : undefined);
  const now = useNowTick(Boolean(running));

  if (!running) return null;

  return (
    <button
      type="button"
      onClick={() => openPanel("time")}
      title="Идёт отсчёт времени — открыть панель «Время»"
      className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent px-2 py-0.5 text-2xs text-accent-foreground transition-colors hover:bg-accent-hover"
    >
      <LiveDot />
      <span className="font-medium tabular-nums">{formatDuration(entryMinutes(running, now))}</span>
    </button>
  );
}
