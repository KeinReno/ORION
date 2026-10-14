export interface PaletteEntry {
  id: string;
  label: string;
  serverResult?: boolean;
  /** Shared by local and server entries for the same record. */
  entityKey?: string;
  /** Search type, used to keep one busy module from hiding every other result. */
  resultGroup?: string;
}

function spreadByGroup<T extends PaletteEntry>(entries: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = entry.resultGroup ?? "other";
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const spread: T[] = [];
  while ([...groups.values()].some((group) => group.length > 0)) {
    for (const group of groups.values()) {
      const next = group.shift();
      if (next) spread.push(next);
    }
  }
  return spread;
}

/** Keep actions visible, give searched modules fair space, and avoid duplicate records. */
export function selectPaletteResults<T extends PaletteEntry>(
  entries: T[],
  query: string,
  serverQuery: string,
  limit = 16
): T[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return entries.filter((entry) => !entry.serverResult).slice(0, limit);

  const local = entries.filter((entry) => !entry.serverResult && entry.label.toLocaleLowerCase().includes(term));
  const quickActions = local.filter((entry) => entry.id.startsWith("a:") || entry.id.startsWith("p:"));
  const serverReady = term.length >= 2 && term === serverQuery.trim().toLocaleLowerCase();
  const server = serverReady ? spreadByGroup(entries.filter((entry) => entry.serverResult)) : [];
  const serverKeys = new Set(server.map((entry) => entry.entityKey).filter(Boolean));
  const localRecords = local.filter((entry) => !quickActions.includes(entry) && !serverKeys.has(entry.entityKey));

  return [...quickActions.slice(0, 4), ...server, ...localRecords].slice(0, limit);
}
