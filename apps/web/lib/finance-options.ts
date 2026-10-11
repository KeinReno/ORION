/**
 * Shared helper for the three finance forms that pick an account/category
 * (TransactionForm, RecurringForm, BudgetForm): a `<Select>` must offer only
 * active entries day-to-day, but editing a record that references an
 * already-archived one must not silently drop its current value out of the
 * list — so that one archived entry is appended, labelled "(архив)". See
 * docs/HISTORY.md v0.13.
 */
export function withArchivedFallback<T extends { id: string; name: string; archivedAt: string | null }>(
  all: T[],
  referencedId: string | null | undefined | (string | null | undefined)[]
): T[] {
  const active = all.filter((item) => !item.archivedAt);
  const referencedIds = (Array.isArray(referencedId) ? referencedId : [referencedId]).filter(
    (id): id is string => Boolean(id) && !active.some((item) => item.id === id)
  );
  const extras = referencedIds
    .map((id) => all.find((item) => item.id === id))
    .filter((item): item is T => Boolean(item))
    .map((item) => ({ ...item, name: `${item.name} (архив)` }));
  return [...active, ...extras];
}
