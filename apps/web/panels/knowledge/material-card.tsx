"use client";

import type { KnowledgeItem } from "@orion/shared-types";
import { FileText, Lightbulb, Link2 } from "lucide-react";
import { relativeTime } from "../../lib/format";
import { KindChip } from "./kind-chip";

/** Источник карточки из origin (список не несёт sources — только деталь). */
function sourceLine(item: KnowledgeItem): { icon: React.ComponentType<{ className?: string }>; text: string } {
  const origin = item.origin;
  if (origin?.sourceUrl) {
    try { return { icon: Link2, text: new URL(origin.sourceUrl).hostname.replace(/^www\./, "") }; } catch { return { icon: Link2, text: origin.sourceUrl.slice(0, 32) }; }
  }
  if (origin?.sourceFile) return { icon: FileText, text: origin.sourceFile };
  return { icon: Lightbulb, text: "введён вручную" };
}

/** Карточка материала на полке (экран 01): тип + время, заголовок, выжимка, источник. */
export function MaterialCard({
  item,
  onOpen,
  onContextMenu
}: {
  item: KnowledgeItem;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}): React.ReactElement {
  const source = sourceLine(item);
  const SourceIcon = source.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className="flex h-[152px] flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-[#4A4A55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span className="flex items-center justify-between gap-2">
        <KindChip kind={item.kind} />
        <span className="shrink-0 font-mono text-[11px] text-[#6E6A60]">{relativeTime(item.updatedAt)}</span>
      </span>
      <span className="mt-2.5 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">{item.title}</span>
      <span className="mt-1.5 line-clamp-2 text-[12px] leading-[18px] text-[#BEB9AF]">{item.summary.trim() || "Без выжимки"}</span>
      <span className="mt-auto flex items-center gap-1.5 pt-2 font-mono text-[10px] text-[#6E6A60]">
        <SourceIcon className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{source.text}</span>
      </span>
    </button>
  );
}
