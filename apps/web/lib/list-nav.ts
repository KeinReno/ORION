/** Step through a visible id list with ↑/↓. Wraps to the first/last item when nothing is selected. */
export function nextListId(ids: string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const index = current ? ids.indexOf(current) : -1;
  if (index < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.max(0, Math.min(ids.length - 1, index + dir))] ?? null;
}
