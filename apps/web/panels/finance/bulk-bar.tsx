"use client";

import type { FinanceCategory, Project } from "@orion/shared-types";
import { Button, Input, Select } from "@orion/ui";
import { Trash2, X } from "lucide-react";
import { useState } from "react";
import type { BulkChange } from "../../lib/finance-bulk-edit";

/**
 * The bar over the list while operations are selected: one change for all of them. Whatever does not fit an operation
 * (a category on a transfer or a split) is skipped and counted by the caller, never applied in some other way.
 */
export function BulkBar({
  count,
  busy,
  categories,
  projects,
  onApply,
  onDelete,
  onClear
}: {
  count: number;
  busy: boolean;
  categories: FinanceCategory[];
  /** Undefined when the «Проекты» module is off. */
  projects: Project[] | undefined;
  onApply: (change: BulkChange) => void;
  onDelete: () => void;
  onClear: () => void;
}): React.ReactElement {
  const [tag, setTag] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2" role="toolbar" aria-label="Действия над выбранными операциями">
      <span className="text-xs font-medium text-foreground">Выбрано: {count}</span>
      <Select
        aria-label="Категория для выбранных"
        value=""
        disabled={busy}
        onChange={(event) => {
          const category = categories.find((c) => c.id === event.target.value);
          if (category) onApply({ kind: "category", categoryId: category.id, categoryKind: category.kind });
        }}
      >
        <option value="">Категория…</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.kind === "income" ? "＋ " : "− "}
            {category.name}
          </option>
        ))}
      </Select>
      {projects ? (
        <Select
          aria-label="Проект для выбранных"
          value=""
          disabled={busy}
          onChange={(event) => {
            if (event.target.value === "") return;
            onApply({ kind: "project", projectId: event.target.value === "__none" ? null : event.target.value });
          }}
        >
          <option value="">Проект…</option>
          <option value="__none">Без проекта</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      ) : null}
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (!tag.trim()) return;
          onApply({ kind: "tag", tag });
          setTag("");
        }}
      >
        <Input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="+ тег" aria-label="Добавить тег выбранным" className="h-8 w-28 text-xs" maxLength={40} disabled={busy} />
      </form>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="danger" size="sm" disabled={busy} onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Удалить
        </Button>
        <Button variant="subtle" size="sm" onClick={onClear}>
          <X className="h-4 w-4" /> Снять выбор
        </Button>
      </div>
    </div>
  );
}
