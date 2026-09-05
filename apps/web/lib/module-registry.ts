import type { SidebarLinkItem } from "@orion/ui";
import { CalendarDays, LayoutDashboard, ListTodo, StickyNote } from "lucide-react";

/**
 * Every ORION module contributes one entry here. The sidebar itself
 * (packages/ui) never changes when a module is added — only this list does.
 */
export const moduleRegistry: SidebarLinkItem[] = [
  { href: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
  { href: "/tasks", label: "Задачи", icon: ListTodo },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/notes", label: "Заметки", icon: StickyNote }
];
