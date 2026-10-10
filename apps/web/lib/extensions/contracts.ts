import type { DocumentItem, Habit, Project } from "@orion/shared-types";
import type { ComponentType, ReactNode } from "react";

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

export interface SlotContracts {
  "habits.insights": HabitsInsightsSlotProps;
  "habits.detail": HabitDetailSlotProps;
  "finance.tabs": FinanceTabSlotProps;
  "tasks.views.bar": TasksViewsBarSlotProps;
  "documents.history": DocumentsHistorySlotProps;
  "documents.editor": DocumentsEditorSlotProps;
  "documents.create": DocumentsCreateSlotProps;
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
  "documents.create": { actions: DocumentCreateAction[] };
}

export type MetaOf<S extends SlotName> = S extends keyof SlotMeta ? SlotMeta[S] : undefined;
