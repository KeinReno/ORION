"use client";

import type { KnowledgeStatus } from "@orion/shared-types";
import { ChevronRight } from "lucide-react";
import { STATUS_LABEL } from "./knowledge-labels";

/** Статусы ленты созревания в порядке пайплайна; «Архив» в ленту не входит. */
const RIBBON: KnowledgeStatus[] = ["captured", "draft", "review", "approved", "published"];

/**
 * Лента созревания под шапкой (экраны 01/02): чипы-фильтры по статусу
 * созревания материала. Клик фильтрует, повторный клик снимает фильтр.
 */
export function StatusRibbon({
  counts,
  active,
  onSelect
}: {
  counts: Record<KnowledgeStatus, number>;
  active: KnowledgeStatus | null;
  onSelect: (status: KnowledgeStatus | null) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Фильтр по статусу созревания">
      {RIBBON.map((status, index) => {
        const selected = active === status;
        return (
          <span key={status} className="flex items-center gap-1.5">
            {index > 0 ? <ChevronRight className="h-3 w-3 text-muted-foreground/60" aria-hidden /> : null}
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(selected ? null : status)}
              className={
                selected
                  ? "flex h-9 items-center gap-2 rounded-full border border-[#C9A86A] bg-[#C9A86A14] px-3 text-[13px] text-[#E7D7A8] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  : "flex h-9 items-center gap-2 rounded-full px-3 text-[13px] text-[#BEB9AF] transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              }
            >
              {STATUS_LABEL[status]}
              <span className="font-mono text-[11px] text-[#6E6A60]">{counts[status] ?? 0}</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
