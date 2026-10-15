"use client";

import {
  useAccounts,
  useCategoryRules,
  useCreateTransaction,
  useDeleteTransaction,
  useFinanceCategories,
  useCore,
  useProjects,
  useTransactions,
  useUpdateTransaction
} from "@orion/core-react";
import { ACCOUNT_CONTEXT_LABEL, type AccountContext, type Transaction } from "@orion/shared-types";
import { Button, ConfirmDialog, EmptyState, Input, Modal, Select, Sheet, Skeleton, useToast } from "@orion/ui";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CheckSquare, Copy, Plus, Receipt, Search, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ExtensionSlot } from "../../lib/extensions/slot";
import { EntityLinksSection } from "../../components/entity-links";
import { ShareGrantSection } from "../../components/share-grant-section";
import { describeAuthError } from "../../lib/error-message";
import { bulkPatch, recreateInput, type BulkChange } from "../../lib/finance-bulk-edit";
import { formatMoney, projectColor, shortDateTime, toKopecks } from "../../lib/format";
import { withArchivedFallback } from "../../lib/finance-options";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { useEnabledModules } from "../../lib/use-enabled-modules";
import type { EntityFocusRequest } from "../../lib/panel-bus";
import { BulkBar } from "./bulk-bar";
import { TransactionForm, type TransactionFormValues } from "./transaction-form";

const PAGE_SIZE = 50;

export function TransactionsView({ focusRequest, onFocusHandled, onOpenAccounts }: { focusRequest: EntityFocusRequest | null; onFocusHandled: (nonce: number) => void; onOpenAccounts?: () => void }): React.ReactElement {
  const { api } = useCore();
  const { workspace } = useActiveWorkspace();
  const [accountFilter, setAccountFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [contextFilter, setContextFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  // The server is asked once typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const minAmount = minText.trim() ? (toKopecks(minText) ?? undefined) : undefined;
  const maxAmount = maxText.trim() ? (toKopecks(maxText) ?? undefined) : undefined;

  // includeArchived: true so an already-archived account/category referenced
  // by an existing operation doesn't vanish from the edit form's <Select> —
  // see withArchivedFallback.
  const { data: accounts } = useAccounts(workspace?.id, true);
  const { data: categories } = useFinanceCategories(workspace?.id, true);
  const { data: categoryRules } = useCategoryRules(workspace?.id);
  // Соседний модуль чужой API не зовёт, пока выключен (CLAUDE.md, инвариант 9).
  const { isEnabled } = useEnabledModules();
  const projectsOn = isEnabled("projects");
  const { data: projects } = useProjects(projectsOn ? workspace?.id : undefined);
  const { data: transactions, isLoading } = useTransactions(workspace?.id, {
    accountId: accountFilter || undefined,
    categoryId: categoryFilter || undefined,
    projectId: projectsOn ? projectFilter || undefined : undefined,
    context: contextFilter || undefined,
    tag: tagFilter || undefined,
    q: query || undefined,
    minAmount,
    maxAmount,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    limit
  });
  const createTransaction = useCreateTransaction(workspace?.id);
  const updateTransaction = useUpdateTransaction(workspace?.id);
  const deleteTransaction = useDeleteTransaction(workspace?.id);
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [copyOf, setCopyOf] = useState<Transaction | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // U02: a document's "связанные записи" (evidence_for pilot) jumps here via
  // focusTransaction(id) — open the same edit Sheet a row click opens.
  useEffect(() => {
    if (!focusRequest || !workspace?.id) return;
    const target = (transactions ?? []).find((t) => t.id === focusRequest.id);
    if (target) {
      setEditing(target);
      onFocusHandled(focusRequest.nonce);
      return;
    }
    if (isLoading) return;
    let cancelled = false;
    void api.getTransaction(workspace.id, focusRequest.id).then(
      (record) => { if (!cancelled) { setEditing(record); onFocusHandled(focusRequest.nonce); } },
      (error) => { if (!cancelled) { toast({ title: "Не удалось открыть операцию", description: describeAuthError(error), tone: "danger" }); onFocusHandled(focusRequest.nonce); } }
    );
    return () => { cancelled = true; };
  }, [api, focusRequest, isLoading, transactions, workspace?.id, toast, onFocusHandled]);

  const activeAccounts = useMemo(() => (accounts ?? []).filter((a) => !a.archivedAt), [accounts]);
  const activeCategories = useMemo(() => (categories ?? []).filter((c) => !c.archivedAt), [categories]);
  const accountName = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  // The context filter appears only once the accounts really differ: with one kind of money it would be noise.
  const usedContexts = useMemo(() => [...new Set((accounts ?? []).filter((a) => !a.archivedAt).map((a) => a.context))] as AccountContext[], [accounts]);
  const projectName = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);
  const categoryById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions ?? []) for (const tag of t.tags) set.add(tag);
    return Array.from(set).sort();
  }, [transactions]);

  async function create(values: TransactionFormValues): Promise<void> {
    await createTransaction.mutateAsync(values);
    setCreating(false);
    setCopyOf(null);
    toast({ title: "Операция добавлена", tone: "success" });
  }

  async function save(transactionId: string, values: TransactionFormValues): Promise<void> {
    await updateTransaction.mutateAsync({ transactionId, input: values });
    setEditing(null);
    toast({ title: "Сохранено", tone: "success" });
  }

  function confirmDelete(): void {
    const transaction = pendingDelete;
    if (!transaction) return;
    setPendingDelete(null);
    deleteTransaction.mutate(transaction.id, {
      onSuccess: () =>
        toast({
          title: "Операция удалена",
          tone: "default",
          duration: 8000,
          action: { label: "Вернуть", onClick: () => void restore([transaction]) }
        })
    });
  }

  /** Undo of a delete: the operation is written again from what was on screen. Its links and import reference are not restored. */
  async function restore(items: Transaction[]): Promise<void> {
    try {
      for (const item of items) await createTransaction.mutateAsync(recreateInput(item));
      toast({ title: items.length > 1 ? `Возвращено операций: ${items.length}` : "Операция возвращена", description: "Связи с записями и ссылка импорта не восстанавливаются.", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось вернуть", description: describeAuthError(error), tone: "danger" });
    }
  }

  const chosen = (transactions ?? []).filter((t) => selected.has(t.id));
  function toggleSelected(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function stopSelecting(): void {
    setSelecting(false);
    setSelected(new Set());
  }

  async function applyBulk(change: BulkChange): Promise<void> {
    let done = 0;
    let skipped = 0;
    setBulkBusy(true);
    try {
      for (const item of chosen) {
        const patch = bulkPatch(item, change);
        if (!patch) {
          skipped += 1;
          continue;
        }
        await updateTransaction.mutateAsync({ transactionId: item.id, input: patch });
        done += 1;
      }
      toast({
        title: `Изменено: ${done}`,
        description: skipped > 0 ? `Пропущено: ${skipped} — изменение к ним не применимо (перевод, разбивка по категориям или уже так).` : undefined,
        tone: done > 0 ? "success" : "default"
      });
    } catch (error) {
      toast({ title: `Остановились на ${done} из ${chosen.length}`, description: describeAuthError(error), tone: "danger" });
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmBulkDelete(): Promise<void> {
    const items = chosen;
    setBulkDeleting(false);
    setBulkBusy(true);
    let removed = 0;
    try {
      for (const item of items) {
        await deleteTransaction.mutateAsync(item.id);
        removed += 1;
      }
    } catch (error) {
      toast({ title: `Удалено ${removed} из ${items.length}`, description: describeAuthError(error), tone: "danger" });
    } finally {
      setBulkBusy(false);
    }
    if (removed > 0) {
      const gone = items.slice(0, removed);
      stopSelecting();
      toast({ title: `Удалено операций: ${removed}`, tone: "default", duration: 8000, action: { label: "Вернуть", onClick: () => void restore(gone) } });
    }
  }

  const hasAccounts = activeAccounts.length > 0;
  const hasMore = (transactions?.length ?? 0) === limit;
  const filtersOn = Boolean(accountFilter || categoryFilter || (projectsOn && projectFilter) || contextFilter || tagFilter || from || to || query || minAmount !== undefined || maxAmount !== undefined);

  return (
    <div className="flex flex-col gap-4">
      <ExtensionSlot name="finance.transactions.top" props={{ workspaceId: workspace?.id }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Фильтр по счёту" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="">Все счета</option>
            {(accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Фильтр по категории" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Все категории</option>
            {(categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          {usedContexts.length > 1 ? (
            <Select aria-label="Фильтр по контексту" value={contextFilter} onChange={(e) => setContextFilter(e.target.value)}>
              <option value="">Все деньги</option>
              {usedContexts.map((value) => (
                <option key={value} value={value}>
                  {ACCOUNT_CONTEXT_LABEL[value]}
                </option>
              ))}
            </Select>
          ) : null}
          {projectsOn ? (
            <Select aria-label="Фильтр по проекту" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">Все проекты</option>
              {(projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-36"
            title="Дата с"
          />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" title="Дата по" />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={selecting ? "outline" : "subtle"} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} disabled={!hasAccounts}>
            {selecting ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />} {selecting ? "Готово" : "Выбрать"}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} disabled={!hasAccounts}>
            <Plus className="h-4 w-4" /> Операция
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по заметке"
          aria-label="Поиск по заметке операции"
          className="w-48"
        />
        <Input inputMode="decimal" value={minText} onChange={(e) => setMinText(e.target.value)} placeholder="Сумма от" aria-label="Сумма от" className="w-28" />
        <Input inputMode="decimal" value={maxText} onChange={(e) => setMaxText(e.target.value)} placeholder="Сумма до" aria-label="Сумма до" className="w-28" />
      </div>

      {selecting && selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          busy={bulkBusy}
          categories={activeCategories}
          projects={projectsOn ? projects : undefined}
          onApply={(change) => void applyBulk(change)}
          onDelete={() => setBulkDeleting(true)}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}
              style={projectColor(tag)}
              className={`rounded-full border px-2 py-0.5 text-2xs font-medium ${tagFilter === tag ? "" : "opacity-60"}`}
            >
              {tag}
            </button>
          ))}
          {tagFilter ? (
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              className="inline-flex items-center gap-0.5 text-2xs text-subtle-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> сбросить
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !hasAccounts ? (
        <EmptyState
          icon={Receipt}
          title="Сначала заведите счёт"
          description="Операции привязываются к конкретному счёту."
          action={
            onOpenAccounts ? (
              <Button size="sm" onClick={onOpenAccounts}>
                Открыть счета
              </Button>
            ) : undefined
          }
        />
      ) : transactions && transactions.length > 0 ? (
        <>
          <ul className="space-y-1.5">
            {transactions.map((transaction) => {
              const isTransfer = transaction.type === "transfer";
              const isIncome = transaction.type === "income";
              const lineCategoryId = !isTransfer ? (transaction.lines[0]?.categoryId ?? null) : null;
              const category = lineCategoryId ? categoryById.get(lineCategoryId) : undefined;
              const splitCount = transaction.lines.length;
              return (
                <li key={transaction.id}>
                  <button
                    type="button"
                    onClick={() => (selecting ? toggleSelected(transaction.id) : setEditing(transaction))}
                    aria-pressed={selecting ? selected.has(transaction.id) : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-row text-left transition-colors hover:border-border hover:bg-card-hover ${selecting && selected.has(transaction.id) ? "border-accent/50 bg-accent/5" : "border-transparent"}`}
                  >
                    {selecting ? (
                      selected.has(transaction.id) ? <CheckSquare className="h-4 w-4 shrink-0 text-accent-text" aria-hidden /> : <Square className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
                    ) : null}
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        isTransfer
                          ? "bg-accent/15 text-accent-text"
                          : isIncome
                            ? "bg-success/15 text-success"
                            : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {isTransfer ? (
                        <ArrowLeftRight className="h-4 w-4" />
                      ) : isIncome ? (
                        <ArrowDownLeft className="h-4 w-4" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {isTransfer
                          ? `${accountName.get(transaction.accountId) ?? "—"} → ${accountName.get(transaction.toAccountId ?? "") ?? "—"}`
                          : transaction.note || category?.name || (isIncome ? "Доход" : "Расход")}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-subtle-foreground">
                        {!isTransfer ? <span>{accountName.get(transaction.accountId) ?? "—"}</span> : null}
                        {splitCount > 1 ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 font-medium leading-none">
                            {splitCount} категории
                          </span>
                        ) : category ? (
                          <span
                            style={projectColor(category.name)}
                            className="rounded-full border px-1.5 py-0.5 font-medium leading-none"
                          >
                            {category.name}
                          </span>
                        ) : null}
                        {transaction.projectId && projectName.get(transaction.projectId) ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 font-medium leading-none">
                            {projectName.get(transaction.projectId)}
                          </span>
                        ) : null}
                        {transaction.tags.map((tag) => (
                          <span key={tag} style={projectColor(tag)} className="rounded-full border px-1.5 py-0.5 font-medium leading-none">
                            #{tag}
                          </span>
                        ))}
                        <span>{shortDateTime(transaction.occurredAt)}</span>
                      </p>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
                        isTransfer ? "text-foreground" : isIncome ? "text-success" : "text-destructive"
                      }`}
                    >
                      {isTransfer ? "" : isIncome ? "+" : "−"}
                      {formatMoney(transaction.totalAmount)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="flex justify-center">
              <Button variant="subtle" size="sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Показать ещё
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={filtersOn ? Search : Receipt}
          title={filtersOn ? "Ничего не найдено" : "Операций пока нет"}
          description={
            filtersOn
              ? "Сбросьте счёт, категорию, тег или даты — в этом пространстве операции могут быть."
              : "Добавьте первую — доход или расход."
          }
          action={
            filtersOn ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAccountFilter("");
                  setCategoryFilter("");
                  setSearch("");
                  setMinText("");
                  setMaxText("");
                  setProjectFilter("");
                  setContextFilter("");
                  setTagFilter(null);
                  setFrom("");
                  setTo("");
                }}
              >
                Сбросить фильтры
              </Button>
            ) : (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Операция
              </Button>
            )
          }
        />
      )}

      <Modal open={creating} onClose={() => { setCreating(false); setCopyOf(null); }} title={copyOf ? "Копия операции" : "Новая операция"} size="sm">
        <TransactionForm
          key={copyOf?.id ?? "new"}
          copyOf={copyOf ?? undefined}
          accounts={activeAccounts}
          categories={activeCategories}
          categoryRules={categoryRules}
          projects={projectsOn ? projects : undefined}
          defaultAccountId={accountFilter || undefined}
          defaultProjectId={projectFilter || undefined}
          busy={createTransaction.isPending}
          submitLabel="Добавить"
          onCancel={() => { setCreating(false); setCopyOf(null); }}
          onSubmit={create}
        />
      </Modal>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title="Операция">
        {editing ? (
          <TransactionForm
            key={editing.id}
            initial={editing}
            accounts={withArchivedFallback(accounts ?? [], [editing.accountId, editing.toAccountId])}
            categories={withArchivedFallback(categories ?? [], editing.lines[0]?.categoryId)}
            categoryRules={categoryRules}
            projects={projectsOn ? projects : undefined}
            busy={updateTransaction.isPending}
            submitLabel="Сохранить"
            onCancel={() => setEditing(null)}
            onSubmit={(values) => save(editing.id, values)}
            onDelete={() => {
              setPendingDelete(editing);
              setEditing(null);
            }}
          />
        ) : null}
        {editing ? (
          <div className="mt-3">
            <Button
              variant="subtle"
              size="sm"
              onClick={() => {
                setCopyOf(editing);
                setEditing(null);
                setCreating(true);
              }}
            >
              <Copy className="h-4 w-4" /> Дублировать
            </Button>
          </div>
        ) : null}
        {editing ? (
          <div className="mt-4 border-t border-border pt-3">
            <EntityLinksSection workspaceId={workspace?.id} type="transaction" id={editing.id} />
          </div>
        ) : null}
        {editing ? (
          <div className="mt-4 border-t border-border pt-3">
            <ShareGrantSection workspaceId={workspace?.id} type="transaction" id={editing.id} />
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={bulkDeleting}
        title={`Удалить операций: ${selected.size}?`}
        description="Баланс счетов и бюджеты пересчитаются. Сразу после удаления можно нажать «Вернуть» — операции запишутся заново, но без связей с другими записями."
        confirmLabel="Удалить"
        onConfirm={() => void confirmBulkDelete()}
        onCancel={() => setBulkDeleting(false)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить операцию?"
        description="Баланс счёта и связанный бюджет пересчитаются. Действие необратимо."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
