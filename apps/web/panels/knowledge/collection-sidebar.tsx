"use client";

import type { KnowledgeCategory } from "@orion/shared-types";
import { Archive, Layers } from "lucide-react";
import { cx } from "@orion/ui";

export type CollectionSelection = string | "all" | "archive";

/**
 * Сайдбар коллекций (экран 01): «Все материалы», коллекции со вложенностью
 * (отступ 20px), внизу отдельным блоком — «Архив».
 */
export function CollectionSidebar({
  categories,
  counts,
  activeId,
  onSelect
}: {
  categories: KnowledgeCategory[];
  counts: Record<string, number>;
  activeId: CollectionSelection;
  onSelect: (id: CollectionSelection) => void;
}): React.ReactElement {
  return (
    <nav aria-label="Коллекции базы знаний" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
      <SidebarItem icon={<Layers className="h-4 w-4" aria-hidden />} label="Все материалы" count={counts.all ?? 0} active={activeId === "all"} onClick={() => onSelect("all")} />
      {categories.map((category) => (
        <SidebarItem
          key={category.id}
          dot
          label={category.name}
          count={counts[category.id] ?? 0}
          depth={category.parentId ? 1 : 0}
          active={activeId === category.id}
          onClick={() => onSelect(category.id)}
        />
      ))}
      <div className="mt-auto pt-3">
        <div className="mb-2 border-t border-border" />
        <SidebarItem icon={<Archive className="h-4 w-4" aria-hidden />} label="Архив" count={counts.archive ?? 0} active={activeId === "archive"} onClick={() => onSelect("archive")} />
      </div>
    </nav>
  );
}

function SidebarItem({
  icon,
  dot,
  label,
  count,
  depth = 0,
  active,
  onClick
}: {
  icon?: React.ReactNode;
  dot?: boolean;
  label: string;
  count: number;
  depth?: number;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{ paddingLeft: depth ? 28 : 10 }}
      className={cx(
        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        active ? "bg-card-hover text-foreground" : "text-muted-foreground hover:bg-card-hover"
      )}
    >
      {dot ? <span className="h-2 w-2 shrink-0 rounded-full bg-[#C9A86A]" aria-hidden /> : icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-mono text-[11px] text-[#6E6A60]">{count}</span>
    </button>
  );
}
