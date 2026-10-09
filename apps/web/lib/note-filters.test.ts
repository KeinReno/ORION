import type { Note } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { EMPTY_NOTE_FILTERS, NO_PROJECT, activeFilterCount, filterNotes, type NoteFilters } from "./note-filters";

function note(id: string, patch: Partial<Note> = {}): Note {
  return {
    id,
    workspaceId: "ws",
    projectId: null,
    title: id,
    summary: "",
    body: "",
    tags: [],
    pinnedAt: null,
    eventAt: null,
    editedAt: null,
    deletedAt: null,
    archivedAt: null,
    dailyOn: null,
    isTemplate: false,
    revision: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...patch
  };
}

const ids = (list: Note[]): string[] => list.map((n) => n.id);
const filters = (patch: Partial<NoteFilters>): NoteFilters => ({ ...EMPTY_NOTE_FILTERS, ...patch });

const notes = [
  note("a", { tags: ["work", "idea"], projectId: "p1", pinnedAt: "2026-09-02T00:00:00.000Z" }),
  note("b", { tags: ["work"], projectId: "p2" }),
  note("c", { tags: ["idea"] }),
  note("d")
];

describe("filterNotes", () => {
  it("returns everything, in the same order, when no filter is on", () => {
    expect(ids(filterNotes(notes, EMPTY_NOTE_FILTERS))).toEqual(["a", "b", "c", "d"]);
  });

  it("matches any of the tags by default and all of them on request", () => {
    expect(ids(filterNotes(notes, filters({ tags: ["work", "idea"] })))).toEqual(["a", "b", "c"]);
    expect(ids(filterNotes(notes, filters({ tags: ["work", "idea"], tagMode: "all" })))).toEqual(["a"]);
  });

  it("filters by a project, and separately by 'no project'", () => {
    expect(ids(filterNotes(notes, filters({ projectId: "p1" })))).toEqual(["a"]);
    expect(ids(filterNotes(notes, filters({ projectId: NO_PROJECT })))).toEqual(["c", "d"]);
  });

  it("keeps only pinned notes", () => {
    expect(ids(filterNotes(notes, filters({ pinnedOnly: true })))).toEqual(["a"]);
  });

  it("combines filters as an intersection", () => {
    expect(ids(filterNotes(notes, filters({ tags: ["work"], projectId: "p2" })))).toEqual(["b"]);
    expect(ids(filterNotes(notes, filters({ tags: ["idea"], projectId: "p2" })))).toEqual([]);
  });
});

describe("activeFilterCount", () => {
  it("counts each tag, the project and the pinned switch, but not the tag mode", () => {
    expect(activeFilterCount(EMPTY_NOTE_FILTERS)).toBe(0);
    expect(activeFilterCount(filters({ tagMode: "all" }))).toBe(0);
    expect(activeFilterCount(filters({ tags: ["a", "b"], projectId: NO_PROJECT, pinnedOnly: true }))).toBe(4);
  });
});
