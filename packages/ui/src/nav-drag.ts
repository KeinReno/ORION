/**
 * One drag at a time, shared by every Sidebar instance. The workbench watches a
 * different MIME type, so a move between bars is not a request to open a tab.
 * Escape marks the drag cancelled; a later drop then changes nothing.
 */

type Listener = (id: string | null) => void;

let dragId: string | null = null;
let cancelled = false;
const listeners = new Set<Listener>();

function emit(): void {
  const id = dragId !== null && !cancelled ? dragId : null;
  for (const listener of listeners) listener(id);
}

export function subscribeNavDrag(listener: Listener): () => void {
  listeners.add(listener);
  listener(dragId !== null && !cancelled ? dragId : null);
  return () => listeners.delete(listener);
}

export function beginNavDrag(id: string): void {
  dragId = id;
  cancelled = false;
  emit();
}

export function cancelNavDrag(): void {
  if (dragId === null) return;
  cancelled = true;
  emit();
}

export function endNavDrag(): void {
  dragId = null;
  cancelled = false;
  emit();
}

export function navDragCancelled(): boolean {
  return cancelled;
}
