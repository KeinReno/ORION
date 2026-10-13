/**
 * Several ORION windows (the main one, detached panels, other browser tabs) share one API
 * but each has its own react-query cache. After a successful change in one window the
 * others must refetch what they show — otherwise an edit made in a detached task window
 * stays invisible in the list until the next poll.
 *
 * The signal is deliberately coarse ("something changed in workspace X"): each window then
 * refetches only its ACTIVE queries, so cost is bounded by what is on screen. The message
 * carries no data — rights are always re-checked by the API on the refetch.
 */

export const SYNC_CHANNEL = "orion-cache-sync";

export interface SyncMessage {
  /** Who sent it, so a window ignores its own echo. */
  from: string;
  at: number;
}

export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export function isSyncMessage(value: unknown): value is SyncMessage {
  return typeof value === "object" && value !== null && typeof (value as SyncMessage).from === "string" && typeof (value as SyncMessage).at === "number";
}

/**
 * Wires a channel to a refetch callback. `notify()` announces a local change (coalesced: a burst
 * of mutations sends one message); incoming messages from other windows call `onRemoteChange`,
 * also coalesced. Returns a disposer.
 */
export function connectCacheSync(
  channel: ChannelLike,
  windowId: string,
  onRemoteChange: () => void,
  options: { delayMs?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void } = {}
): { notify: () => void; dispose: () => void } {
  const delay = options.delayMs ?? 250;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let outgoing: unknown = null;
  let incoming: unknown = null;

  const listener = (event: { data: unknown }): void => {
    if (!isSyncMessage(event.data) || event.data.from === windowId) return;
    if (incoming !== null) return;
    incoming = setTimer(() => {
      incoming = null;
      onRemoteChange();
    }, delay);
  };
  channel.addEventListener("message", listener);

  return {
    notify() {
      if (outgoing !== null) return;
      outgoing = setTimer(() => {
        outgoing = null;
        channel.postMessage({ from: windowId, at: Date.now() } satisfies SyncMessage);
      }, delay);
    },
    dispose() {
      channel.removeEventListener("message", listener);
      if (outgoing !== null) clearTimer(outgoing);
      if (incoming !== null) clearTimer(incoming);
      channel.close();
    }
  };
}
