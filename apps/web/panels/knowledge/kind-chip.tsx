"use client";

import type { KnowledgeKind } from "@orion/shared-types";
import { KIND_COLOR, KIND_LABEL } from "./knowledge-labels";

/** Чип типа материала: цвет и фон из таблицы типов. */
export function KindChip({ kind }: { kind: KnowledgeKind }): React.ReactElement {
  const color = KIND_COLOR[kind];
  return (
    <span
      className="rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]"
      style={{ color, backgroundColor: `${color}1F` }}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}
