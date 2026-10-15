import type { SearchableEntityType } from "@orion/shared-types";
import {
  CalendarDays,
  FileText,
  FolderKanban,
  Flag,
  ListChecks,
  ListTodo,
  Receipt,
  StickyNote,
  UserRound,
  Wallet,
  type LucideIcon
} from "lucide-react";

/** One icon and one Russian noun per linkable entity type — shared by the links block and the context panel. */
export const ENTITY_TYPE_ICON: Record<SearchableEntityType, LucideIcon> = {
  goal: Flag,
  savings_goal: Flag,
  project: FolderKanban,
  task: ListTodo,
  note: StickyNote,
  event: CalendarDays,
  document: FileText,
  transaction: Receipt,
  contact: UserRound,
  list: ListChecks,
  account: Wallet
};

export const ENTITY_TYPE_LABEL: Record<SearchableEntityType, string> = {
  goal: "цель",
  savings_goal: "цель накопления",
  project: "проект",
  task: "задача",
  note: "заметка",
  event: "событие",
  document: "документ",
  transaction: "операция",
  contact: "контакт",
  list: "список",
  account: "счёт"
};
