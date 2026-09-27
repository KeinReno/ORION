"use client";

import { useEffect, useState } from "react";

/**
 * "Now" that re-renders its owner once a second while `enabled`. This is the
 * whole live-timer mechanism: a running entry's duration is derived from its
 * `startedAt` through `entryMinutes(entry, now)`, so ticking is a local
 * re-render and never a request — the server is only asked whether a timer is
 * running at all (`useRunningTimer`, once a minute).
 */
export function useNowTick(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    // Re-sync immediately: `now` may be stale from the moment the timer started.
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}
