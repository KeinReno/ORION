import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { msUntilNextLocalMidnight, watchDayBoundary, type DayBoundaryDeps } from "./day-boundary";

/**
 * A minimal fake `setTimeout`/`clearTimeout` pair driven entirely by
 * `vi.useFakeTimers()`, plus a manually-triggerable wake source, so the
 * watcher can be exercised deterministically: advance the clock, or fire a
 * wake, and assert exactly when `onChange` was called.
 */
function makeDeps(initialNow: Date, onChange: (key: string) => void) {
  let current = initialNow;
  const wakeListeners = new Set<() => void>();
  return {
    deps: {
      now: () => current,
      setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
      clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onChange,
      addWakeListener: (recheck: () => void) => {
        wakeListeners.add(recheck);
        return () => wakeListeners.delete(recheck);
      }
    } satisfies DayBoundaryDeps,
    setNow(next: Date) {
      current = next;
    },
    fireWake() {
      for (const listener of wakeListeners) listener();
    }
  };
}

describe("msUntilNextLocalMidnight", () => {
  it("returns the gap to 00:00:01 local time, not a flat 24h", () => {
    const now = new Date(2026, 8, 21, 23, 59, 0, 0); // 21 сентября 23:59:00 local
    const ms = msUntilNextLocalMidnight(now);
    expect(ms).toBe(61_000); // 1 минута до полуночи + 1s буфер
  });

  it("never returns less than 1s even called exactly at the boundary", () => {
    const now = new Date(2026, 8, 22, 0, 0, 1, 0);
    expect(msUntilNextLocalMidnight(now)).toBeGreaterThanOrEqual(1000);
  });

  it("is 23h (not 24h) across a spring-forward DST transition", () => {
    // America/New_York, DST начинается 2026-03-08 02:00 -> 03:00 (весенний
    // перевод "вперёд" крадёт час). Полночь 7 → полночь 8 марта — 23-часовой
    // локальный день, а не 24: чистое `+24h` в миллисекундах отсчитало бы
    // неверный момент внутри уже переведённого дня.
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const now = new Date(2026, 2, 7, 23, 0, 0, 0); // 7 марта 23:00 local (before transition)
      const ms = msUntilNextLocalMidnight(now);
      // 1h to midnight, but that local day is 23h long -> wall-clock gap is
      // still exactly "1 hour of local wall-clock" because midnight itself
      // (00:00 Mar 8) is before the 02:00 transition — so the *next* day's
      // length is what differs, not this particular gap. Assert indirectly:
      // walking two consecutive local-midnight-to-midnight spans around the
      // transition must not both be 24h.
      expect(ms).toBe(60 * 60 * 1000 + 1000);

      const midnightMar8 = new Date(now.getTime() + ms - 1000); // exact local midnight, no buffer
      const msNextSpan = msUntilNextLocalMidnight(midnightMar8);
      // Mar 8 -> Mar 9 local midnight is the transition day itself: 23h, not 24h.
      expect(msNextSpan).toBe(23 * 60 * 60 * 1000 + 1000);
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe("watchDayBoundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onChange when the clock crosses local midnight (23:59 -> 00:01)", () => {
    const onChange = vi.fn();
    const start = new Date(2026, 8, 21, 23, 59, 0, 0);
    const { deps, setNow } = makeDeps(start, onChange);
    const watcher = watchDayBoundary(deps);

    // Advance real elapsed time to 00:01 the next day, keeping `now()` in
    // sync with the fake clock (the watcher only ever asks `deps.now()`).
    const twoMinutesMs = 2 * 60 * 1000;
    setNow(new Date(start.getTime() + twoMinutesMs));
    vi.advanceTimersByTime(twoMinutesMs);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-09-22");
    watcher.stop();
  });

  it("does not fire again for a wake recheck on the same day", () => {
    const onChange = vi.fn();
    const start = new Date(2026, 8, 21, 12, 0, 0, 0);
    const { deps, fireWake } = makeDeps(start, onChange);
    const watcher = watchDayBoundary(deps);

    fireWake();
    fireWake();

    expect(onChange).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("recovers a day change on visibility/focus wake even if the midnight timer never fired (throttled background tab)", () => {
    // Simulates an 8h sleep: the tab's timers are frozen/dropped for the
    // whole gap (no `vi.advanceTimersByTime` at all — nothing "ticks"), then
    // the OS wakes and the tab fires a focus event with the clock having
    // silently jumped forward.
    const onChange = vi.fn();
    const sleepStart = new Date(2026, 8, 21, 23, 0, 0, 0); // 23:00 before sleep
    const { deps, setNow, fireWake } = makeDeps(sleepStart, onChange);
    const watcher = watchDayBoundary(deps);

    const wakeTime = new Date(2026, 8, 22, 7, 0, 0, 0); // 07:00 next day, 8h later
    setNow(wakeTime);
    // No timer advance — the armed setTimeout is still "pending" and would
    // only fire on its own after real time catches up; a throttled
    // background tab may never actually run it. The wake listener is the
    // only thing that ran.
    fireWake();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-09-22");
    watcher.stop();
  });

  it("re-arms after firing so a second midnight also fires", () => {
    const onChange = vi.fn();
    const start = new Date(2026, 8, 21, 23, 59, 0, 0);
    const { deps, setNow } = makeDeps(start, onChange);
    const watcher = watchDayBoundary(deps);

    setNow(new Date(2026, 8, 22, 0, 1, 0, 0));
    vi.advanceTimersByTime(2 * 60 * 1000);
    setNow(new Date(2026, 8, 23, 0, 1, 0, 0));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, "2026-09-22");
    expect(onChange).toHaveBeenNthCalledWith(2, "2026-09-23");
    watcher.stop();
  });

  it("stop() detaches the wake listener and clears the timer", () => {
    const onChange = vi.fn();
    const start = new Date(2026, 8, 21, 23, 59, 0, 0);
    const { deps, setNow, fireWake } = makeDeps(start, onChange);
    const watcher = watchDayBoundary(deps);
    watcher.stop();

    setNow(new Date(2026, 8, 22, 0, 1, 0, 0));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    fireWake();

    expect(onChange).not.toHaveBeenCalled();
  });
});
