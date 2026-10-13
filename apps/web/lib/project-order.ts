/**
 * The viewer's own order of projects ("Мой порядок" in the projects list). A per-viewer,
 * per-workspace convenience kept in localStorage — it never changes what other members see.
 * Projects not in the saved order (new ones) go after the ordered ones, in the order given.
 */

export function projectOrderKey(userId: string, workspaceId: string): string {
  return `orion.projectOrder:${userId}:${workspaceId}`;
}

export function applyProjectOrder<T extends { id: string }>(projects: readonly T[], order: readonly string[]): T[] {
  const position = new Map(order.map((id, index) => [id, index]));
  const known = projects.filter((p) => position.has(p.id)).sort((a, b) => (position.get(a.id) as number) - (position.get(b.id) as number));
  const fresh = projects.filter((p) => !position.has(p.id));
  return [...known, ...fresh];
}

/**
 * Moves `dragId` to sit right before `beforeId` (or to the end when `beforeId` is null) inside
 * the currently VISIBLE ids. Ids hidden by a filter keep their relative place: the result is the
 * full order, not just the visible slice.
 */
export function moveProject(fullOrder: readonly string[], visibleIds: readonly string[], dragId: string, beforeId: string | null): string[] {
  if (dragId === beforeId || !visibleIds.includes(dragId)) return [...fullOrder];
  const visible = visibleIds.filter((id) => id !== dragId);
  const at = beforeId === null ? visible.length : visible.indexOf(beforeId);
  if (at < 0) return [...fullOrder];
  visible.splice(at, 0, dragId);
  // Re-thread the visible ids through the slots they occupied; hidden ids stay where they were.
  const visibleSet = new Set(visibleIds);
  const merged = [...fullOrder.filter((id) => !visibleSet.has(id) || visibleIds.includes(id))];
  const slots: number[] = [];
  merged.forEach((id, index) => {
    if (visibleSet.has(id)) slots.push(index);
  });
  // Visible ids missing from fullOrder (never ordered yet) are appended first, so every one has a slot.
  for (const id of visibleIds) {
    if (!merged.includes(id)) {
      merged.push(id);
      slots.push(merged.length - 1);
    }
  }
  const result = [...merged];
  visible.forEach((id, i) => {
    result[slots[i]] = id;
  });
  return result;
}

/** One step up (-1) or down (+1) among the visible ids: the keyboard alternative to dragging. */
export function stepProject(fullOrder: readonly string[], visibleIds: readonly string[], id: string, step: 1 | -1): string[] {
  const index = visibleIds.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= visibleIds.length) return [...fullOrder];
  // Moving down = drop before the item after the next one; moving up = before the previous one.
  const beforeId = step === -1 ? visibleIds[target] : (visibleIds[target + 1] ?? null);
  return moveProject(fullOrder, visibleIds, id, beforeId);
}
