"use client";

import {
  useAccounts,
  useCategoryRules,
  useCreateTransaction,
  useDeleteTransaction,
  useFinanceCategories,
  useTransactions,
  useUpdateTransaction
} from "@orion/core-react";
import type { Transaction } from "@orion/shared-types";
import { Button, ConfirmDialog, EmptyState, Input, Modal, Select, Sheet, Skeleton, useToast } from "@orion/ui";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, Receipt, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ExtensionSlot } from "../../lib/extensions/slot";
import { EntityLinksSection } from "../../components/entity-links";
import { ShareGrantSection } from "../../components/share-grant-section";
import { formatMoney, projectColor, shortDateTime } from "../../lib/format";
import { withArchivedFallback } from "../../lib/finance-options";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { useFocusedTransactionId } from "../../lib/panel-bus";
import { TransactionForm, type TransactionFormValues } from "./transaction-form";

const PAGE_SIZE = 50;

export function TransactionsView({ onOpenAccounts }: { onOpenAccounts?: () => void }): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const [accountFilter, setAccountFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  // includeArchived: true so an already-archived account/category referenced
  // by an existing operation doesn't vanish from the edit form's <Select> —
  // see withArchivedFallback.
  const { data: accounts } = useAccounts(workspace?.id, true);
  const { data: categories } = useFinanceCategories(workspace?.id, true);
  const { data: categoryRules } = useCategoryRules(workspace?.id);
  const { data: transactions, isLoading } = useTransactions(workspace?.id, {
    accountId: accountFilter || undefined,
    categoryId: categoryFilter || undefined,
    tag: tagFilter || undefined,
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

  // U02: a document's "связанные записи" (evidence_for pilot) jumps here via
  // focusTransaction(id) — open the same edit Sheet a row click opens.
  const focusedTransactionId = useFocusedTransactionId();
  useEffect(() => {
    if (!focusedTransactionId) return;
    const target = (transactions ?? []).find((t) => t.id === focusedTransactionId);
    if (target) setEditing(target);
  }, [focusedTransactionId, transactions]);

  const activeAccounts = useMemo(() => (accounts ?? []).filter((a) => !a.archivedAt), [accounts]);
  const activeCategories = useMemo(() => (categories ?? []).filter((c) => !c.archivedAt), [categories]);
  const accountName = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  const categoryById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions ?? []) for (const tag of t.tags) set.add(tag);
    return Array.from(set).sort();
  }, [transactions]);

  async function create(values: TransactionFormValues): Promise<void> {
    await createTransaction.mutateAsync(values);
    setCreating(false);
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
    deleteTransaction.mutate(transaction.id, { onSuccess: () => toast({ title: "Операция удалена", tone: "default" }) });
  }

  const hasAccounts = activeAccounts.length > 0;
  const hasMore = (transactions?.length ?? 0) === limit;
  const filtersOn = Boolean(accountFilter || categoryFilter || tagFilter || from || to);

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
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-36"
            title="Дата с"
          />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" title="Дата по" />
        </div>
        <Button size="sm" onClick={() => setCreating(true)} disabled={!hasAccounts}>
          <Plus className="h-4 w-4" /> Операция
        </Button>
      </div>

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
                    onClick={() => setEditing(transaction)}
                    className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-row text-left transition-colors hover:border-border hover:bg-card-hover"
                  >
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

      <Modal open={creating} onClose={() => setCreating(false)} title="Новая операция" size="sm">
        <TransactionForm
          accounts={activeAccounts}
          categories={activeCategories}
          categoryRules={categoryRules}
          defaultAccountId={accountFilter || undefined}
          busy={createTransaction.isPending}
          submitLabel="Добавить"
          onCancel={() => setCreating(false)}
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
        open={pendingDelete !== null}
        title="Удалить операцию?"
        description="Баланс счёта и связанный бюджет пересчитаются. Действие необратимо."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
