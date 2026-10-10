import type { Habit } from "@orion/shared-types";

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

export interface SlotContracts {
  "habits.insights": HabitsInsightsSlotProps;
  "habits.detail": HabitDetailSlotProps;
  "finance.tabs": FinanceTabSlotProps;
}

export type SlotName = keyof SlotContracts;

/**
 * Extra, typed information a contribution gives the HOST about itself (not props for the
 * component). Only slots that need it are listed; for the rest `meta` is absent.
 */
export interface SlotMeta {
  "finance.tabs": { tabId: string; label: string };
}

export type MetaOf<S extends SlotName> = S extends keyof SlotMeta ? SlotMeta[S] : undefined;
