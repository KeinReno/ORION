import type { SidebarLinkItem } from "@orion/ui";
import { LayoutDashboard, StickyNote } from "lucide-react";

/**
 * Every ORION module contributes one entry here. The sidebar itself
 * (packages/ui) never changes when a module is added — only this list does.
 */
export const moduleRegistry: SidebarLinkItem[] = [
  { href: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
  { href: "/notes", label: "Заметки", icon: StickyNote }
];
