import { describe, expect, it, vi } from "vitest";
import { observeNativeActivity } from "./native-activity";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("native foreground observation", () => {
  it("waits for confirmed native state and follows pause/resume", async () => {
    let listener!: (state: { isActive: boolean }) => void;
    const state = deferred<{ isActive: boolean }>(); const remove = vi.fn(async () => {});
    const changed = vi.fn();
    const stop = observeNativeActivity({ getState: () => state.promise,
      addListener: async (_, callback) => { listener = callback; return { remove }; } }, changed);
    expect(changed.mock.calls).toEqual([[false]]);
    await flush(); state.resolve({ isActive: false }); await flush();
    expect(changed.mock.calls).toEqual([[false], [false]]);
    listener({ isActive: true }); listener({ isActive: false });
    expect(changed.mock.calls.slice(-2)).toEqual([[true], [false]]);
    stop(); listener({ isActive: true }); expect(changed.mock.calls.slice(-1)).toEqual([[false]]);
    expect(remove).toHaveBeenCalledOnce();
  });
  it("does not let a delayed active read override a newer pause event", async () => {
    let listener!: (state: { isActive: boolean }) => void;
    const state = deferred<{ isActive: boolean }>(); const changed = vi.fn();
    const stop = observeNativeActivity({ getState: () => state.promise,
      addListener: async (_, callback) => { listener = callback; return { remove: async () => {} }; } }, changed);
    await flush(); listener({ isActive: false }); state.resolve({ isActive: true }); await flush();
    expect(changed.mock.calls).toEqual([[false], [false]]); stop();
  });
  it("removes late subscriptions after cleanup without reading or publishing activity", async () => {
    const registration = deferred<{ remove(): Promise<void> }>();
    const changed = vi.fn(), remove = vi.fn(async () => {}), getState = vi.fn(async () => ({ isActive: true }));
    const stop = observeNativeActivity({ getState, addListener: () => registration.promise }, changed);
    stop(); registration.resolve({ remove }); await flush();
    expect(remove).toHaveBeenCalledOnce(); expect(getState).not.toHaveBeenCalled();
    expect(changed.mock.calls).toEqual([[false]]);
  });
  it("stays paused when native state is unavailable and ignores a read after disposal", async () => {
    const changed = vi.fn(); const stop = observeNativeActivity({ getState: async () => { throw new Error("Unavailable"); },
      addListener: async () => ({ remove: async () => {} }) }, changed);
    await flush(); expect(changed.mock.calls).toEqual([[false]]); stop();
    const state = deferred<{ isActive: boolean }>();
    const stopLate = observeNativeActivity({ getState: () => state.promise, addListener: async () => ({ remove: async () => {} }) }, changed);
    await flush(); stopLate(); state.resolve({ isActive: true }); await flush();
    expect(changed.mock.calls).toEqual([[false], [false]]);
  });
});
