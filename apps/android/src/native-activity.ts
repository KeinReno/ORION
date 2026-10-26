interface Activity { isActive: boolean }
interface ActivitySource {
  getState(): Promise<Activity>;
  addListener(event: "appStateChange", listener: (state: Activity) => void): Promise<{ remove(): Promise<void> }>;
}

/** Register before reading state. A delayed initial read must never override a
 * newer pause/resume event, or start work after the observer has been disposed.
 */
export function observeNativeActivity(source: ActivitySource, changed: (active: boolean) => void) {
  let disposed = false, revision = 0;
  let handle: { remove(): Promise<void> } | undefined;
  changed(false);
  void (async () => {
    try {
      const registered = await source.addListener("appStateChange", state => {
        if (disposed) return;
        revision++; changed(state.isActive);
      });
      if (disposed) { await registered.remove(); return; }
      handle = registered;
      const before = revision;
      const state = await source.getState();
      if (!disposed && revision === before) changed(state.isActive);
    } catch { /* Unknown native state stays paused; manual sync is still available. */ }
  })();
  return () => { disposed = true; void handle?.remove().catch(() => {}); };
}
