import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NoteAutosave, type AutosaveConflict, type AutosaveSnapshot, type AutosaveState, type SaveAck } from "./note-autosave";

function snap(body: string): AutosaveSnapshot {
  return { title: "T", summary: "", body, tags: [], eventAt: null, projectId: null };
}

/** A promise this test controls the settling of — no real network/timers. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("NoteAutosave — trailing drain + CAS (S11)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drains the trailing edit automatically, and only reports 'saved' after the LATEST content is acknowledged", async () => {
    const calls: Array<{ snapshot: AutosaveSnapshot; expectedRevision: number }> = [];
    const pending: Array<ReturnType<typeof deferred<SaveAck>>> = [];
    const states: AutosaveState[] = [];
    const errors: unknown[] = [];

    const autosave = new NoteAutosave(
      { workspaceId: "ws1", noteId: "n1" },
      {
        debounceMs: 900,
        revision: 1,
        initial: snap(""),
        save: (_identity, snapshot, expectedRevision) => {
          calls.push({ snapshot, expectedRevision });
          const d = deferred<SaveAck>();
          pending.push(d);
          return d.promise;
        },
        onStateChange: (s) => states.push(s),
        onError: (e) => errors.push(e)
      }
    );

    // Step 1: type A, advance debounce, request A goes out and is pending (not resolved).
    autosave.setSnapshot(snap("A"));
    vi.advanceTimersByTime(900);
    expect(calls).toHaveLength(1);
    expect(calls[0].snapshot.body).toBe("A");
    expect(calls[0].expectedRevision).toBe(1);
    expect(states.at(-1)).toBe("saving");

    // Step 2: type B, advance debounce, request A is STILL pending — no second
    // request must be sent (single in-flight), B just waits.
    autosave.setSnapshot(snap("B"));
    vi.advanceTimersByTime(900);
    expect(calls).toHaveLength(1); // still just A — the in-flight guard held

    // Step 3: resolve A. A trailing-drain save for B must go out automatically,
    // with NO further user input (no setSnapshot call between here and the assert).
    // The drain is a direct re-call, not a new setTimeout, so only microtasks
    // need flushing — advancing fake timers here would also fire unrelated
    // pending debounce timers and isn't representative of step 3 alone.
    pending[0].resolve({ revision: 2 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls[1].snapshot.body).toBe("B");
    expect(calls[1].expectedRevision).toBe(2); // revision from A's ack, not stale

    // Step 4: type C while B is still pending. The final saved content must
    // end up being C, and "saved" must NOT appear until C itself is acked.
    autosave.setSnapshot(snap("C"));
    expect(states.at(-1)).not.toBe("saved");

    // Step 5: reject B (simulated network failure). C must remain an unsaved
    // draft with a visible error — NOT silently retried in a loop — and
    // retry() must send the CURRENT snapshot (C) with the correct (still A's,
    // since B never landed) revision, not the stale B snapshot.
    pending[1].reject(new Error("network down"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toHaveLength(1);
    expect(states.at(-1)).toBe("error");
    // No silent infinite retry: still only 2 calls made so far.
    expect(calls).toHaveLength(2);

    autosave.retry();
    await Promise.resolve();
    expect(calls).toHaveLength(3);
    expect(calls[2].snapshot.body).toBe("C"); // the ACTUAL latest snapshot, not the rejected B one
    expect(calls[2].expectedRevision).toBe(2); // still revision from A's ack — B never updated it

    pending[2].resolve({ revision: 3 });
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(states.at(-1)).toBe("saved");
    expect(calls).toHaveLength(3); // nothing further pending — no phantom drain
  });

  it("never has two saves in flight at once, even under a burst of edits", async () => {
    let inFlightCount = 0;
    let maxConcurrent = 0;
    const pending: Array<ReturnType<typeof deferred<SaveAck>>> = [];

    const autosave = new NoteAutosave(
      { workspaceId: "ws1", noteId: "n1" },
      {
        debounceMs: 100,
        revision: 1,
        initial: snap(""),
        save: () => {
          inFlightCount += 1;
          maxConcurrent = Math.max(maxConcurrent, inFlightCount);
          const d = deferred<SaveAck>();
          pending.push(d);
          return d.promise.finally(() => {
            inFlightCount -= 1;
          });
        },
        onStateChange: () => {},
        onError: () => {}
      }
    );

    for (let i = 0; i < 5; i++) {
      autosave.setSnapshot(snap(`v${i}`));
      vi.advanceTimersByTime(100);
    }
    // Resolve every in-flight save as it appears until nothing is pending.
    for (let i = 0; i < 10 && pending.length > 0; i++) {
      const d = pending[pending.length - 1];
      d.resolve({ revision: i + 2 });
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(maxConcurrent).toBe(1);
  });

  it("surfaces a 409 as 'conflict', not a generic retryable error — two clients editing the same note", async () => {
    const states: AutosaveState[] = [];
    const conflicts: AutosaveConflict[] = [];
    const serverCurrent = snap("someone else's edit");
    const autosave = new NoteAutosave(
      { workspaceId: "ws1", noteId: "n1" },
      {
        debounceMs: 10,
        revision: 1,
        initial: snap(""),
        save: () => {
          const conflict: AutosaveConflict = { conflict: true, currentRevision: 5, current: serverCurrent };
          return Promise.reject(conflict);
        },
        onStateChange: (s) => states.push(s),
        onConflict: (c) => conflicts.push(c)
      }
    );
    autosave.setSnapshot(snap("my edit"));
    vi.advanceTimersByTime(10);
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toBe("conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].currentRevision).toBe(5);

    // Accepting the server's version resets the CAS baseline in place.
    autosave.adoptServerState(serverCurrent, 5);
    expect(states.at(-1)).toBe("saved");
  });

  it("does not deliver a stale save's result after dispose() (unmount race)", async () => {
    const states: AutosaveState[] = [];
    const d = deferred<SaveAck>();
    const autosave = new NoteAutosave(
      { workspaceId: "ws1", noteId: "n1" },
      {
        debounceMs: 10,
        revision: 1,
        initial: snap(""),
        save: () => d.promise,
        onStateChange: (s) => states.push(s)
      }
    );
    autosave.setSnapshot(snap("A"));
    vi.advanceTimersByTime(10);
    autosave.dispose();
    d.resolve({ revision: 99 });
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).not.toBe("saved");
  });
});
