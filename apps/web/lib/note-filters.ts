import type { Note } from "@orion/shared-types";

/** `NO_PROJECT` is a real choice ("notes that belong to no project"), distinct from "any project" (null). */
export const NO_PROJECT = "__none__";

export interface NoteFilters {
  tags: readonly string[];
  tagMode: "any" | "all";
  /** null = any project; `NO_PROJECT` = only notes without one; otherwise a project id. */
  projectId: string | null;
  pinnedOnly: boolean;
}

export const EMPTY_NOTE_FILTERS: NoteFilters = { tags: [], tagMode: "any", projectId: null, pinnedOnly: false };

/** How many independent narrowing conditions are on (tag mode alone is not one). */
export function activeFilterCount(filters: NoteFilters): number {
  return filters.tags.length + (filters.projectId !== null ? 1 : 0) + (filters.pinnedOnly ? 1 : 0);
}

/**
 * Narrow an already-loaded note list. Search is applied by the server and is a
 * separate concern; these filters only subtract, never reorder.
 */
export function filterNotes(notes: readonly Note[], filters: NoteFilters): Note[] {
  return notes.filter((note) => {
    if (filters.pinnedOnly && note.pinnedAt === null) return false;
    if (filters.projectId === NO_PROJECT && note.projectId !== null) return false;
    if (filters.projectId !== null && filters.projectId !== NO_PROJECT && note.projectId !== filters.projectId) return false;
    if (filters.tags.length === 0) return true;
    return filters.tagMode === "all"
      ? filters.tags.every((tag) => note.tags.includes(tag))
      : filters.tags.some((tag) => note.tags.includes(tag));
  });
}
