/** Window-local object metadata. Core consumes this contract without importing modules. */
export interface PanelObjectContext {
  workspaceId: string;
  panelId: string;
  entityType: string;
  entityId: string;
  title: string;
  saveState: "saved" | "dirty" | "saving" | "error" | "conflict";
  hasPendingChanges: boolean;
  saveMode?: "autosave" | "explicit";
}

export function createObjectContextStore() {
  const records = new Map<string, PanelObjectContext>();
  const listeners = new Set<() => void>();
  const key = (workspaceId: string, panelId: string) => JSON.stringify([workspaceId, panelId]);
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get(workspaceId: string, panelId: string) { return records.get(key(workspaceId, panelId)) ?? null; },
    publish(record: PanelObjectContext) {
      const id = key(record.workspaceId, record.panelId);
      records.set(id, record);
      emit();
      return () => {
        // A late cleanup from the previous editor must not erase its replacement.
        if (records.get(id) !== record) return;
        records.delete(id);
        emit();
      };
    }
  };
}
