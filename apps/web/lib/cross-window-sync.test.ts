import { describe, expect, it } from "vitest";
import { connectCacheSync, isSyncMessage, type ChannelLike } from "./cross-window-sync";

/** Two in-memory endpoints of one channel; a message goes to the OTHER endpoint only, like BroadcastChannel. */
function pair(): [ChannelLike, ChannelLike] {
  const listeners: Array<Set<(event: { data: unknown }) => void>> = [new Set(), new Set()];
  const make = (me: number): ChannelLike => ({
    postMessage: (message) => listeners[1 - me].forEach((listener) => listener({ data: message })),
    addEventListener: (_type, listener) => listeners[me].add(listener),
    removeEventListener: (_type, listener) => listeners[me].delete(listener),
    close: () => listeners[me].clear()
  });
  return [make(0), make(1)];
}

/** Manual timers so the test controls "later". */
function manualTimers() {
  const queue: Array<() => void> = [];
  return {
    setTimer: (fn: () => void) => {
      queue.push(fn);
      return fn;
    },
    clearTimer: (handle: unknown) => {
      const index = queue.indexOf(handle as () => void);
      if (index >= 0) queue.splice(index, 1);
    },
    flush: () => {
      while (queue.length) queue.shift()?.();
    }
  };
}

describe("isSyncMessage", () => {
  it("accepts only well-formed messages", () => {
    expect(isSyncMessage({ from: "a", at: 1 })).toBe(true);
    expect(isSyncMessage({ from: "a" })).toBe(false);
    expect(isSyncMessage(null)).toBe(false);
    expect(isSyncMessage("x")).toBe(false);
  });
});

describe("connectCacheSync", () => {
  it("a change in window A triggers one refetch in window B and none in A itself", () => {
    const [chA, chB] = pair();
    const timers = manualTimers();
    let refetchA = 0;
    let refetchB = 0;
    const a = connectCacheSync(chA, "A", () => refetchA++, timers);
    connectCacheSync(chB, "B", () => refetchB++, timers);

    a.notify();
    a.notify(); // a burst of mutations is one announcement
    a.notify();
    timers.flush(); // outgoing fires → B schedules its refetch
    timers.flush();

    expect(refetchB).toBe(1);
    expect(refetchA).toBe(0);
  });

  it("ignores foreign garbage on the channel", () => {
    const [chA, chB] = pair();
    const timers = manualTimers();
    let refetch = 0;
    connectCacheSync(chB, "B", () => refetch++, timers);
    chA.postMessage({ nonsense: true });
    timers.flush();
    expect(refetch).toBe(0);
  });

  it("dispose stops delivery", () => {
    const [chA, chB] = pair();
    const timers = manualTimers();
    let refetch = 0;
    const b = connectCacheSync(chB, "B", () => refetch++, timers);
    b.dispose();
    chA.postMessage({ from: "A", at: 1 });
    timers.flush();
    expect(refetch).toBe(0);
  });
});
