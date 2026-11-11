import type { SearchableEntityType } from "@orion/shared-types";
import {
  BookOpen,
  CalendarDays,
  FileText,
  FolderKanban,
  Flag,
  Library,
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
  account: Wallet,
  project_log_entry: BookOpen,
  // Общие инструменты (задание 10): материал базы знаний — тоже связуемая сущность.
  knowledge_item: Library
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
  account: "счёт",
  project_log_entry: "запись журнала",
  knowledge_item: "материал"
};
