"use client";

import { habitLocalDayKey } from "@orion/shared-types";
import { useEffect, useMemo, useState } from "react";
import { watchDayBoundary } from "./day-boundary";

/**
 * React-facing wrapper around `watchDayBoundary` (S10) — see `day-boundary.ts`
 * for the framework-free core and the rationale. Panels/badges that group or
 * range things by "today" should read `useDayKey()`/`useLocalNow()` instead
 * of calling `new Date()`/`habitLocalDayKey()` directly, so a real day change
 * (midnight while the tab is open, or waking a laptop that slept through the
 * night) recomputes their client-side grouping without anyone needing to
 * remember a timer. It deliberately does *not* force a refetch: existing
 * data just gets re-partitioned against the new day, exactly like any other
 * derived value keyed off this hook.
 */
export function useDayKey(): string {
  const [dayKey, setDayKey] = useState(() => habitLocalDayKey());

  useEffect(() => {
    // Catch up immediately: mount could itself be the wake moment (e.g. the
    // panel was lazily created after the tab regained focus).
    setDayKey(habitLocalDayKey());

    const watcher = watchDayBoundary({
      now: () => new Date(),
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onChange: setDayKey,
      addWakeListener: (recheck) => {
        const onVisible = (): void => {
          if (document.visibilityState === "visible") recheck();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", recheck);
        return () => {
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("focus", recheck);
        };
      }
    });

    return () => watcher.stop();
  }, []);

  return dayKey;
}

/**
 * A `Date` that only changes when `useDayKey()` does — i.e. at a real local
 * day boundary or a visibility/focus wake recheck, not on every render. For
 * consumers (`localDayRange`, `partitionOpenTasks`, `habitLocalDayKey`) that
 * need an actual `Date` rather than just the key string.
 */
export function useLocalNow(): Date {
  const dayKey = useDayKey();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `dayKey` is the intentional recompute trigger, not `new Date()`'s identity.
  return useMemo(() => new Date(), [dayKey]);
}
