import type { DocumentItem, Habit, Note, Project, TimeEntry } from "@orion/shared-types";
import type { ComponentType, ReactNode } from "react";
import type { TimeProjectTotal, TimeSummary } from "../time-summary";

/**
 * The typed contract of every extension slot: exactly the props a host module hands to
 * whatever plugin fills the slot. These types are the whole public surface between a
 * module and its plugins — a plugin may not reach into the module's files, and a module
 * may not know a plugin's. Changing a contract is an architectural decision (an
 * Extension Proposal), not an edit made while building a feature.
 */

/** habits.insights — history-oriented blocks next to the daily checklist (week grid, activity map). */
export interface HabitsInsightsSlotProps {
  workspaceId: string | undefined;
  /** The workspace's non-archived habits, with the server's per-day fields. */
  habits: Habit[];
  /** Open the host's own edit UI for a habit — the host owns editing, the plugin only asks. */
  onEditHabit: (habit: Habit) => void;
  /** Archive through the host (it also owns the undo toast). */
  onArchiveHabit: (habit: Habit) => void;
}

/** habits.detail — the same history, narrowed to ONE habit, inside the host's edit sheet. */
export interface HabitDetailSlotProps {
  workspaceId: string | undefined;
  habit: Habit;
  onArchiveHabit: (habit: Habit) => void;
}

/** finance.tabs — a tab of the Finance panel. The host draws the tab strip from each contribution's `meta`. */
export interface FinanceTabSlotProps {
  workspaceId: string | undefined;
}

/** tasks.views.bar — named filter presets in the Tasks panel header. The host owns the filters; the plugin saves and re-applies them. */
export interface TasksViewsBarSlotProps {
  workspaceId: string | undefined;
  projects: Project[];
  /** The filters the panel currently has. */
  current: { search: string; projectId: string | null };
  /** Ask the host to take these filters. */
  onApply: (criteria: { search: string; projectId: string | null }) => void;
}

/**
 * documents.history — a dialog the host opens for one file. The host adds the menu entry
 * (label from `meta`) and keeps `doc` (null = closed); the plugin draws the dialog itself.
 */
export interface DocumentsHistorySlotProps {
  workspaceId: string | undefined;
  doc: DocumentItem | null;
  onClose: () => void;
}

/**
 * documents.editor — an in-app editor for some kinds of files. The contribution's `meta.handles`
 * tells the host which documents it opens; for those the host renders it instead of the plain
 * viewer, and `fallback` is what to show if the editor cannot open the file.
 */
export interface DocumentsEditorSlotProps {
  workspaceId: string;
  doc: DocumentItem;
  fallback: ReactNode;
}

/** documents.create — contributes "new file" actions; it draws nothing, the host owns upload and selection. */
export type DocumentsCreateSlotProps = Record<string, never>;

export interface DocumentCreateAction {
  id: string;
  /** Label in the compact "Добавить" menu, e.g. «Новый документ». */
  menuLabel: string;
  /** Label on the toolbar button, e.g. «Документ». */
  buttonLabel: string;
  icon: ComponentType<{ className?: string }>;
  successTitle: string;
  /** Builds the empty file; the host uploads it into the current folder. */
  createFile: () => Promise<File>;
}

/**
 * notes.history — the version-history dialog of one note. The host shows a button when a plugin
 * fills the slot (label from `meta.buttonLabel`) and keeps `open`; the plugin draws the dialog.
 */
export interface NotesHistorySlotProps {
  workspaceId: string | undefined;
  noteId: string;
  /** The text in the editor right now (maybe unsaved) — the history diffs against it. */
  currentTitle: string;
  currentBody: string;
  open: boolean;
  onClose: () => void;
  /** A past version was restored: the host reloads the note. */
  onRestored: () => void;
}

/**
 * time.billing — money for tracked time. A plugin fills it with the presentational pieces the host
 * and the insights block use when they show a cost; it draws nothing by itself (the contribution's
 * component is a placeholder, the substance is `meta.api`). Without it no money is shown anywhere.
 */
export interface TimeBillingApi {
  /** Cost lines under the totals, or the «not priced» note. */
  SummaryCosts: ComponentType<{ summary: TimeSummary; ratesKnown: boolean; projectsOn: boolean }>;
  /** The «*» next to a project name when part of its time has no rate. */
  ProjectMark: ComponentType<{ item: TimeProjectTotal; summary: TimeSummary }>;
  /** The cost (or «—») at the end of a per-project row. */
  ProjectCost: ComponentType<{ item: TimeProjectTotal; ratesKnown: boolean }>;
  /** What a log row shows as its cost; null = nothing. */
  entryCost: (entry: TimeEntry, projects: Project[], now: Date) => { text: string; title?: string; partial?: boolean } | null;
}

export type TimeBillingSlotProps = Record<string, never>;

/** time.insights — the «Итоги» block and the «Динамика» charts of the Time panel. */
export interface TimeInsightsSlotProps {
  workspaceId: string | undefined;
  /** Active and archived projects (rates and names live there). */
  allProjects: Project[];
  projectNames: Map<string, string>;
  /** The loaded log — breakdowns are computed from it. */
  entries: TimeEntry[];
  summary: TimeSummary;
  /** False until the projects have loaded — until then no money and no «rate missing» is shown. */
  ratesKnown: boolean;
  projectsOn: boolean;
  /** Exact server-side totals in minutes (undefined while loading). */
  headline: { today: number | undefined; week: number | undefined; total: number | undefined };
  /** The money pieces, only when a billing plugin is on. */
  billing: TimeBillingApi | null;
}

/** calendar.toolbar — extra controls at the end of the source-chip row (the filter chips of the Calendar header). */
export interface CalendarToolbarSlotProps {
  workspaceId: string | undefined;
}

/**
 * tasks.detail.tabs — a tab in the lower part of the task detail pane (next to the built-in
 * «История» and «Связи»). The host draws the tab strip from each contribution's `meta`.
 */
export interface TaskDetailTabSlotProps {
  workspaceId: string | undefined;
  taskId: string;
}

/**
 * tasks.views — an extra way to lay out the task columns. Draws nothing itself (the contribution's
 * component is a placeholder): the host keeps the columns and drag-and-drop and asks the view only
 * for its label and the layout classes of the column container.
 */
export type TasksViewSlotProps = Record<string, never>;

export interface TasksViewMeta {
  viewId: string;
  label: string;
  /** Tailwind classes of the element that holds the columns, for `columnCount` columns. */
  layoutClass: (columnCount: number) => string;
  /** Layout of one column in this view (the host's own list view uses full width). */
  columnClass?: string;
}

/** notes.header.actions — extra buttons in the Notes header, before «Новая». */
export interface NotesHeaderActionSlotProps {
  workspaceId: string | undefined;
  /** Ask the host to show this note (switches to the active list and selects it). */
  onOpenNote: (noteId: string) => void;
}

/** notes.filters — a chip at the start of the filter row of the notes list. */
export interface NotesFilterSlotProps {
  workspaceId: string | undefined;
  active: boolean;
  onToggle: () => void;
}

/** notes.header.actions.end — a control after «Новая» in the Notes header (shown outside the template list). */
export interface NotesTemplatePickerSlotProps {
  workspaceId: string | undefined;
  onOpenNote: (noteId: string) => void;
}

/**
 * notes.templates — «a note can be a template». Draws nothing: its presence tells the host to offer the
 * template list view and the row/editor command; `meta.toggleLabel` is that command's wording.
 */
export type NotesTemplatesSlotProps = Record<string, never>;

export interface SlotContracts {
  "habits.insights": HabitsInsightsSlotProps;
  "habits.detail": HabitDetailSlotProps;
  "finance.tabs": FinanceTabSlotProps;
  "tasks.views.bar": TasksViewsBarSlotProps;
  "documents.history": DocumentsHistorySlotProps;
  "documents.editor": DocumentsEditorSlotProps;
  "documents.create": DocumentsCreateSlotProps;
  "notes.history": NotesHistorySlotProps;
  "time.insights": TimeInsightsSlotProps;
  "time.billing": TimeBillingSlotProps;
  "calendar.toolbar": CalendarToolbarSlotProps;
  "tasks.detail.tabs": TaskDetailTabSlotProps;
  "tasks.views": TasksViewSlotProps;
  "notes.header.actions": NotesHeaderActionSlotProps;
  "notes.filters": NotesFilterSlotProps;
  "notes.header.actions.end": NotesTemplatePickerSlotProps;
  "notes.templates": NotesTemplatesSlotProps;
}

export type SlotName = keyof SlotContracts;

/**
 * Extra, typed information a contribution gives the HOST about itself (not props for the
 * component). Only slots that need it are listed; for the rest `meta` is absent.
 */
export interface SlotMeta {
  "finance.tabs": { tabId: string; label: string };
  "documents.history": { actionLabel: string };
  "documents.editor": { handles: (doc: DocumentItem) => boolean };
  "notes.history": { buttonLabel: string };
  "time.billing": { api: TimeBillingApi };
  /** `before`: the tab goes before the built-in ones (default after them). */
  "tasks.detail.tabs": { tabId: string; label: string; before?: boolean };
  "tasks.views": TasksViewMeta;
  "notes.templates": { toggleLabel: (note: Note) => string };
  "documents.create": { actions: DocumentCreateAction[] };
}

export type MetaOf<S extends SlotName> = S extends keyof SlotMeta ? SlotMeta[S] : undefined;
