"use client";

import {
  useCategoryRules,
  useCreateCategoryRule,
  useCreateFinanceCategory,
  useDeleteCategoryRule,
  useDeleteFinanceCategory,
  useFinanceCategories,
  useUpdateFinanceCategory
} from "@orion/core-react";
import type { FinanceCategory, FinanceCategoryKind } from "@orion/shared-types";
import { Button, ConfirmDialog, IconButton, Input, Modal, SegmentedControl, Select, useToast } from "@orion/ui";
import { ArchiveRestore, Archive, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeAuthError } from "../../lib/error-message";
import { projectColor } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

/**
 * Categories are shared infrastructure across Transactions/Budgets/
 * Recurring — not their own tab (see docs/PLAN.md v0.8), so this is a
 * standalone modal opened from FinancePanel's header, reachable from any
 * tab. Same list+inline-form shape as NotesPanel's tag chips, one level
 * more structured (kind is a real field here, not free text). The "Правила"
 * section (v0.13) is auto-categorization matching — applied only in
 * TransactionForm, never server-side.
 */
export function CategoryManagerModal({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: categories } = useFinanceCategories(workspace?.id, includeArchived);
  const createCategory = useCreateFinanceCategory(workspace?.id);
  const updateCategory = useUpdateFinanceCategory(workspace?.id);
  const deleteCategory = useDeleteFinanceCategory(workspace?.id);
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<FinanceCategoryKind>("expense");
  const [pendingDelete, setPendingDelete] = useState<FinanceCategory | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await createCategory.mutateAsync({ name: name.trim(), kind });
      setName("");
      toast({ title: "Категория добавлена", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось добавить категорию", description: describeAuthError(error), tone: "danger" });
    }
  }

  function toggleArchived(category: FinanceCategory): void {
    updateCategory.mutate(
      { categoryId: category.id, input: { archivedAt: category.archivedAt ? null : new Date().toISOString() } },
      {
        onSuccess: () =>
          toast({ title: category.archivedAt ? "Категория восстановлена" : "Категория отправлена в архив", tone: "default" })
      }
    );
  }

  function confirmDelete(): void {
    const category = pendingDelete;
    if (!category) return;
    setPendingDelete(null);
    deleteCategory.mutate(category.id, { onSuccess: () => toast({ title: "Категория удалена", tone: "default" }) });
  }

  const income = (categories ?? []).filter((c) => c.kind === "income");
  const expense = (categories ?? []).filter((c) => c.kind === "expense");

  return (
    <>
      <Modal open={open} onClose={onClose} title="Категории" size="sm">
        <div className="mb-3 flex justify-end">
          <SegmentedControl
            value={includeArchived ? "all" : "active"}
            onChange={(v) => setIncludeArchived(v === "all")}
            options={[
              { value: "active", label: "Активные" },
              { value: "all", label: "Все" }
            ]}
          />
        </div>
        <form onSubmit={submit} className="mb-4 flex gap-2">
          <Input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Select value={kind} onChange={(e) => setKind(e.target.value as FinanceCategoryKind)}>
            <option value="expense">Расход</option>
            <option value="income">Доход</option>
          </Select>
          <Button type="submit" size="sm" disabled={createCategory.isPending || !name.trim()}>
            Добавить
          </Button>
        </form>

        <div className="space-y-4">
          <CategoryGroup title="Расходы" categories={expense} onDelete={setPendingDelete} onToggleArchive={toggleArchived} />
          <CategoryGroup title="Доходы" categories={income} onDelete={setPendingDelete} onToggleArchive={toggleArchived} />
        </div>

        <CategoryRulesSection categories={(categories ?? []).filter((c) => !c.archivedAt)} />
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить категорию?"
        description={
          pendingDelete
            ? `«${pendingDelete.name}» — операции останутся без категории, связанные бюджеты удалятся. Действие необратимо.`
            : undefined
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

function CategoryGroup({
  title,
  categories,
  onDelete,
  onToggleArchive
}: {
  title: string;
  categories: FinanceCategory[];
  onDelete: (category: FinanceCategory) => void;
  onToggleArchive: (category: FinanceCategory) => void;
}): React.ReactElement {
  return (
    <div>
      <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{title}</p>
      {categories.length === 0 ? (
        <p className="text-xs text-subtle-foreground">Пока нет</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <li
              key={category.id}
              style={projectColor(category.name)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium ${
                category.archivedAt ? "opacity-50" : ""
              }`}
            >
              {category.name}
              <IconButton
                label={category.archivedAt ? `Восстановить ${category.name}` : `Архивировать ${category.name}`}
                size="sm"
                onClick={() => onToggleArchive(category)}
              >
                {category.archivedAt ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
              </IconButton>
              <IconButton label={`Удалить ${category.name}`} size="sm" tone="danger" onClick={() => onDelete(category)}>
                <Trash2 className="h-3 w-3" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Case-insensitive substring rules ("матч по заметке → категория"), applied
 * only in TransactionForm on note change — the server never rewrites a
 * category on its own. No update: a rule is cheap enough to delete and
 * recreate rather than PATCH.
 */
function CategoryRulesSection({ categories }: { categories: FinanceCategory[] }): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { data: rules } = useCategoryRules(workspace?.id);
  const createRule = useCreateCategoryRule(workspace?.id);
  const deleteRule = useDeleteCategoryRule(workspace?.id);
  const { toast } = useToast();

  const [matchText, setMatchText] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const targetCategoryId = categoryId || categories[0]?.id;
    if (!matchText.trim() || !targetCategoryId) return;
    try {
      await createRule.mutateAsync({ matchText: matchText.trim(), categoryId: targetCategoryId });
      setMatchText("");
      toast({ title: "Правило добавлено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось добавить правило", description: describeAuthError(error), tone: "danger" });
    }
  }

  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">Правила автокатегоризации</p>
      <p className="mb-2 text-2xs text-subtle-foreground">
        При совпадении текста с заметкой операции категория подставится автоматически (можно изменить вручную).
      </p>
      <form onSubmit={submit} className="mb-3 flex gap-2">
        <Input placeholder="Текст в заметке" value={matchText} onChange={(e) => setMatchText(e.target.value)} className="flex-1" />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={createRule.isPending || !matchText.trim() || categories.length === 0}>
          Добавить
        </Button>
      </form>
      {rules && rules.length > 0 ? (
        <ul className="space-y-1">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
              <span>
                «{rule.matchText}» → <span className="text-foreground">{categoryById.get(rule.categoryId)?.name ?? "—"}</span>
              </span>
              <IconButton label="Удалить правило" size="sm" tone="danger" onClick={() => deleteRule.mutate(rule.id)}>
                <Trash2 className="h-3 w-3" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-2xs text-subtle-foreground">Правил пока нет</p>
      )}
    </div>
  );
}
