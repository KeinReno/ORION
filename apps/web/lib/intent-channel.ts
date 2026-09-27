/**
 * Pure, framework-free core of the panel-bus "pending intent" mechanism
 * (S09 — see `panel-bus.ts` for the full rationale and the React-facing
 * wrapper). Kept free of React/DOM so the emit → late-subscribe → consume
 * sequencing can be unit-tested deterministically, without mounting real
 * components or racing real timers.
 *
 * Invariant this module exists to guarantee:
 *   - A late subscriber (one that starts listening *after* `emit` was
 *     called) still receives the last emitted value for its scope — an
 *     emit before a listener exists is not simply dropped.
 *   - A value is applied at most once: `consumePending` clears the slot
 *     unconditionally, whether or not the scope matched, so a later
 *     `consumePending` call (e.g. a remount) never replays an already
 *     acknowledged or already-discarded-as-stale intent.
 *   - Only the single latest emitted value is retained per channel — a
 *     second `emit` before anyone consumes the first overwrites it rather
 *     than queuing both.
 *   - A value is only *applied* by `consumePending` if the scope
 *     (`workspaceId`) passed to `consumePending` matches the scope the
 *     value was emitted with; a scope mismatch still consumes (drops) the
 *     pending slot, so a stale cross-scope value can't leak into a later
 *     matching consume.
 */
export interface IntentChannel<T> {
  /** Deliver `value` to current listeners, or retain it (scoped to `workspaceId`) if none exist yet. */
  emit(value: T, workspaceId: string | null): void;
  /** Register a live listener; returns an unsubscribe function. */
  subscribe(listener: (value: T) => void): () => void;
  /**
   * Called by a consumer as it becomes ready to receive (e.g. on mount).
   * Always acknowledges (clears) any pending value. Returns it only if its
   * scope matches `workspaceId`; otherwise returns `null` (stale, discarded).
   */
  consumePending(workspaceId: string | null): T | null;
  /** True if at least one live listener is currently registered. */
  hasListeners(): boolean;
}

export function createIntentChannel<T>(): IntentChannel<T> {
  const listeners = new Set<(value: T) => void>();
  let pending: { value: T; workspaceId: string | null } | null = null;

  return {
    emit(value, workspaceId) {
      if (listeners.size > 0) {
        // Delivered live — acknowledge/drop any older retained value so a
        // future remount can't replay it.
        pending = null;
        for (const listener of listeners) listener(value);
      } else {
        pending = { value, workspaceId };
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    consumePending(workspaceId) {
      if (!pending) return null;
      const intent = pending;
      pending = null;
      return intent.workspaceId === workspaceId ? intent.value : null;
    },
    hasListeners() {
      return listeners.size > 0;
    }
  };
}
