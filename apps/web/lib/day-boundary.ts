import { habitLocalDayKey } from "@orion/shared-types";

/**
 * Pure, framework-free core of the reactive local-day mechanism (S10). Kept
 * free of React/DOM so the midnight-timer and wake-recheck sequencing can be
 * unit-tested deterministically with fake timers, without mounting real
 * components — see `use-day-boundary.ts` for the React-facing wrapper
 * (`useDayKey`/`useLocalNow`) that panels/badges actually import.
 *
 * Why this exists: `DashboardPanel`, the sidebar's overdue-task badge
 * (`app/(app)/layout.tsx`) and `HabitsPanel` each used to compute "today"
 * once — `habitLocalDayKey()`/`new Date()` called directly in the render
 * body or captured once in `useState(() => new Date())` — and never again.
 * A tab left open from evening to midnight, or a laptop that sleeps through
 * the night, kept showing yesterday until *something else* happened to
 * trigger a re-render (a refetch, an unrelated click). `HabitsPanel` even
 * did this on purpose, with a comment explaining it was to avoid columns
 * "shifting under the cursor" — a reasonable worry for a render triggered by
 * unrelated state, but not a reason to stay frozen forever: this module only
 * flips the day at two well-defined moments (real local midnight, or the tab
 * becoming visible/focused again), never on an arbitrary re-render, so it
 * keeps that guarantee while fixing the freeze.
 *
 * Invariants this module exists to guarantee:
 *   - The day key only ever changes at a local-midnight boundary or an
 *     explicit recheck (visibility/focus), never as a side effect of some
 *     unrelated re-render — consumers can safely memoize off it.
 *   - The midnight timer is computed from calendar components
 *     (`getFullYear`/`getMonth`/`getDate() + 1`), not `+ 24h` in
 *     milliseconds: a DST-transition day is 23h or 25h long, and only the
 *     components form survives that without drifting or double-firing.
 *   - A background tab whose `setTimeout` was throttled/dropped by the OS
 *     during sleep still recovers: `visibilitychange`/`focus` force an
 *     immediate recheck, which is also how a missed/late midnight timer
 *     self-heals (it re-arms on every recheck, not just once).
 */

export interface DayBoundaryWatcher {
  /** Stop the timer and detach whatever listeners `start()` attached. */
  stop(): void;
}

export interface DayBoundaryDeps {
  now(): Date;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Called once, synchronously, whenever the computed day key changes. */
  onChange(dayKey: string): void;
  /** Register a wake-recheck source (visibilitychange, focus, ...); returns an unsubscribe. */
  addWakeListener(recheck: () => void): () => void;
}

/**
 * `Date` local-midnight arithmetic is safe across DST because it goes
 * through calendar components, not raw millisecond addition: the `Date`
 * constructor resolves `(year, month, date + 1, 0, 0, 1)` against the local
 * offset in effect for *that* calendar day, so the gap to it is naturally
 * 23h/24h/25h depending on whether a transition falls in between. A flat
 * `+ 24 * 60 * 60 * 1000` would land an hour early or late on a transition
 * day and could fire the timer twice (or miss the boundary) for that one day
 * a year.
 */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  const ms = next.getTime() - now.getTime();
  // Guard against a pathological zero/negative delta (clock skew, a `now()`
  // exactly on the boundary) turning into a busy-loop of zero-delay timers.
  return Math.max(1000, ms);
}

/**
 * Starts the watcher: arms a DST-safe timer for the next local midnight,
 * recomputing and re-arming every time it fires or a wake listener requests
 * a recheck. Calls `deps.onChange(dayKey)` only when the key actually
 * differs from the last one reported — a recheck that lands on the same day
 * (e.g. focus regained mid-afternoon) is a no-op for consumers.
 */
export function watchDayBoundary(deps: DayBoundaryDeps): DayBoundaryWatcher {
  let lastKey = habitLocalDayKey(deps.now());
  let timer: unknown;

  const arm = (): void => {
    if (timer !== undefined) deps.clearTimeout(timer);
    timer = deps.setTimeout(recheck, msUntilNextLocalMidnight(deps.now()));
  };

  function recheck(): void {
    const key = habitLocalDayKey(deps.now());
    if (key !== lastKey) {
      lastKey = key;
      deps.onChange(key);
    }
    arm();
  }

  arm();
  const detachWake = deps.addWakeListener(recheck);

  return {
    stop() {
      if (timer !== undefined) deps.clearTimeout(timer);
      detachWake();
    }
  };
}
