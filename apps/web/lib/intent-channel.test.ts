import { describe, expect, it } from "vitest";
import { createIntentChannel } from "./intent-channel";

/**
 * S09 — the two scenarios from
 * docs/HISTORY.md:
 *   1. `focusTask(X)` emits before the Tasks panel has mounted (e.g. it's
 *      being lazily opened by this very click) — the panel must still end
 *      up focused on X once it mounts, not silently miss it.
 *   2. While the panel for entity X in workspace W1 is still "loading"
 *      (mount not yet run), the user switches to workspace W2 — the stale
 *      W1 intent must not apply once the panel does mount under W2.
 *
 * Both are modeled with a controlled, deterministic sequence of direct
 * calls (emit → subscribe → consumePending) rather than a real timer or a
 * real dynamic import, so there's no flakiness tied to actual latency.
 */
describe("intent-channel (panel-bus pending intent, S09)", () => {
  it("scenario 1: emit before the consumer mounts is still applied once it mounts", () => {
    const channel = createIntentChannel<string>();

    // focusTask(X) — panel not mounted yet, so emit lands with 0 listeners.
    channel.emit("task-X", "workspace-1");
    expect(channel.hasListeners()).toBe(false);

    // Lazy import resolves, panel mounts, subscribes, and asks for whatever
    // was pending — this is what `useIntent`'s effect does on mount.
    let selected: string | null = null;
    const applied = channel.consumePending("workspace-1");
    if (applied !== null) selected = applied;
    const unsubscribe = channel.subscribe((value) => {
      selected = value;
    });

    expect(selected).toBe("task-X");
    unsubscribe();
  });

  it("scenario 2: an intent stamped in W1 does not apply once the consumer mounts under W2", () => {
    const channel = createIntentChannel<string>();

    // User clicks a link to X while W1 is active — panel isn't mounted yet.
    channel.emit("task-X", "workspace-1");

    // Before the panel finishes mounting, the user switches workspaces.
    // (The active-workspace store is synchronous/global in the real app —
    // simulated here by just passing the new id to consumePending.)
    const activeWorkspaceNow = "workspace-2";

    let selected: string | null = null;
    const applied = channel.consumePending(activeWorkspaceNow);
    if (applied !== null) selected = applied;

    expect(applied).toBeNull();
    expect(selected).toBeNull();

    // And the stale intent is gone for good — it must not resurface if the
    // user switches back to W1 and something else mounts later.
    const secondConsume = channel.consumePending("workspace-1");
    expect(secondConsume).toBeNull();
  });

  it("a second emit while the first is still pending overwrites it (last click wins, no queueing)", () => {
    const channel = createIntentChannel<string>();

    channel.emit("task-A", "workspace-1");
    channel.emit("task-B", "workspace-1"); // user clicked again before mount

    const applied = channel.consumePending("workspace-1");
    expect(applied).toBe("task-B");

    // Only ever consumed once — draining it again yields nothing, not "task-A".
    expect(channel.consumePending("workspace-1")).toBeNull();
  });

  it("delivers live to an already-subscribed listener without going through pending", () => {
    const channel = createIntentChannel<string>();
    const received: string[] = [];
    const unsubscribe = channel.subscribe((value) => received.push(value));

    channel.emit("task-X", "workspace-1");

    expect(received).toEqual(["task-X"]);
    // Nothing left pending for a later remount to incorrectly replay.
    expect(channel.consumePending("workspace-1")).toBeNull();
    unsubscribe();
  });

  it("an already-consumed (acknowledged) intent is never re-applied on a later remount", () => {
    const channel = createIntentChannel<string>();

    channel.emit("task-X", "workspace-1");
    expect(channel.consumePending("workspace-1")).toBe("task-X"); // first mount consumes it

    // Panel unmounts and remounts (e.g. dockview panel closed and reopened)
    // without any new emit in between.
    expect(channel.consumePending("workspace-1")).toBeNull();
  });
});
