"use client";

import {
  useAccounts,
  useCreateFinanceTemplate,
  useCreateTransaction,
  useDeleteFinanceTemplate,
  useFinanceCategories,
  useFinanceTemplates,
  useUpdateFinanceTemplate
} from "@orion/core-react";
import type { CreateFinanceTemplateInput, FinanceTemplate, TransactionType } from "@orion/shared-types";
import { Button, Input, Modal, Select, useToast } from "@orion/ui";
import { Pencil, Plus, Zap } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { FinanceTransactionsTopSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError, formatMoney, fromDatetimeLocal, fromKopecks, toDatetimeLocal, toKopecks } from "../../lib/extensions/host-api";

const TYPE_LABEL: Record<TransactionType, string> = { expense: "Расход", income: "Доход", transfer: "Перевод" };

/**
 * Plugin `finance-templates`: a strip of saved starting points over the operations. A click opens a small confirmation
 * (account, amount, date) and writes an ORDINARY operation — a template itself never moves money. A template without
 * an amount asks for it every time; one whose account was deleted asks for another account.
 */
export function TemplatesBar({ workspaceId }: FinanceTransactionsTopSlotProps): React.ReactElement | null {
  const { data: templates } = useFinanceTemplates(workspaceId);
  const { data: accounts } = useAccounts(workspaceId);
  const { data: categories } = useFinanceCategories(workspaceId);
  const [using, setUsing] = useState<FinanceTemplate | null>(null);
  const [editing, setEditing] = useState<{ template: FinanceTemplate | null } | null>(null);
  const activeAccounts = useMemo(() => (accounts ?? []).filter((account) => !account.archivedAt), [accounts]);
  if (activeAccounts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Шаблоны операций">
      <span className="flex items-center gap-1 text-2xs text-subtle-foreground">
        <Zap className="h-3.5 w-3.5" aria-hidden /> Шаблоны
      </span>
      {(templates ?? []).map((template) => (
        <span key={template.id} className="group inline-flex items-center rounded-full border border-border bg-card text-xs">
          <button type="button" onClick={() => setUsing(template)} className="rounded-l-full px-2.5 py-1 text-muted-foreground hover:text-foreground">
            {template.name}
            {template.amount ? <span className="ml-1.5 font-mono text-2xs tabular-nums text-subtle-foreground">{formatMoney(template.amount)}</span> : null}
          </button>
          <button
            type="button"
            onClick={() => setEditing({ template })}
            aria-label={`Изменить шаблон «${template.name}»`}
            className="rounded-r-full px-1.5 py-1 text-subtle-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={() => setEditing({ template: null })} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-subtle-foreground hover:text-foreground">
        <Plus className="h-3 w-3" /> Шаблон
      </button>

      {using ? <UseTemplateModal workspaceId={workspaceId} template={using} accounts={activeAccounts} onClose={() => setUsing(null)} /> : null}
      {editing ? (
        <EditTemplateModal
          workspaceId={workspaceId}
          template={editing.template}
          accounts={activeAccounts}
          categories={(categories ?? []).filter((category) => !category.archivedAt)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function UseTemplateModal({
  workspaceId,
  template,
  accounts,
  onClose
}: {
  workspaceId: string | undefined;
  template: FinanceTemplate;
  accounts: { id: string; name: string; currency: string }[];
  onClose: () => void;
}): React.ReactElement {
  const create = useCreateTransaction(workspaceId);
  const { toast } = useToast();
  // A template whose account is gone (or archived) falls back to «choose».
  const knownAccount = (id: string | null): string => (id && accounts.some((account) => account.id === id) ? id : "");
  const [accountId, setAccountId] = useState(knownAccount(template.accountId));
  const [toAccountId, setToAccountId] = useState(knownAccount(template.toAccountId));
  const [amount, setAmount] = useState(fromKopecks(template.amount ?? undefined));
  const [when, setWhen] = useState(toDatetimeLocal(new Date().toISOString()));
  const [error, setError] = useState<string | null>(null);
  const kopecks = toKopecks(amount);
  const isTransfer = template.type === "transfer";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!kopecks) return setError("Введите сумму больше нуля");
    if (!accountId) return setError("Выберите счёт");
    if (isTransfer && (!toAccountId || toAccountId === accountId)) return setError("Выберите другой счёт назначения");
    try {
      await create.mutateAsync({
        accountId,
        toAccountId: isTransfer ? toAccountId : null,
        type: template.type,
        note: template.note || template.name,
        tags: template.tags,
        projectId: template.projectId,
        occurredAt: fromDatetimeLocal(when) ?? new Date().toISOString(),
        lines: [{ categoryId: isTransfer ? null : template.categoryId, amount: kopecks }]
      });
      toast({ title: `Записано: ${template.name}`, tone: "success" });
      onClose();
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  return (
    <Modal open onClose={onClose} title={template.name} description={`${TYPE_LABEL[template.type]} по шаблону — запишется обычной операцией.`} size="sm">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          {isTransfer ? "Со счёта" : "Счёт"}
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            <option value="">Выберите счёт…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </label>
        {isTransfer ? (
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            На счёт
            <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
              <option value="">Выберите счёт…</option>
              {accounts.filter((account) => account.id !== accountId).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Сумма
          <Input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Когда
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        {error ? <p className="text-2xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={create.isPending}>
            Записать
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditTemplateModal({
  workspaceId,
  template,
  accounts,
  categories,
  onClose
}: {
  workspaceId: string | undefined;
  template: FinanceTemplate | null;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; kind: "income" | "expense" }[];
  onClose: () => void;
}): React.ReactElement {
  const create = useCreateFinanceTemplate(workspaceId);
  const update = useUpdateFinanceTemplate(workspaceId);
  const remove = useDeleteFinanceTemplate(workspaceId);
  const { toast } = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [type, setType] = useState<TransactionType>(template?.type ?? "expense");
  const [accountId, setAccountId] = useState(template?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState(template?.toAccountId ?? "");
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? "");
  const [amount, setAmount] = useState(fromKopecks(template?.amount ?? undefined));
  const [note, setNote] = useState(template?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const kindOfType = type === "income" ? "income" : "expense";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return setError("Укажите название");
    let kopecks: number | null = null;
    if (amount.trim()) {
      kopecks = toKopecks(amount);
      if (!kopecks) return setError("Сумма — число больше нуля, либо оставьте пустой");
    }
    const input: CreateFinanceTemplateInput = {
      name: name.trim(),
      type,
      accountId: accountId || null,
      toAccountId: type === "transfer" ? toAccountId || null : null,
      categoryId: type === "transfer" ? null : categoryId || null,
      projectId: template?.projectId ?? null,
      amount: kopecks,
      note: note.trim(),
      tags: template?.tags ?? []
    };
    try {
      if (template) await update.mutateAsync({ templateId: template.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  async function destroy(): Promise<void> {
    if (!template) return;
    try {
      await remove.mutateAsync(template.id);
      toast({ title: "Шаблон удалён", description: "Операции, записанные по нему, остались.", tone: "default" });
      onClose();
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  return (
    <Modal open onClose={onClose} title={template ? "Шаблон операции" : "Новый шаблон"} size="sm">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Название, например «Обед»" maxLength={60} autoFocus />
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-white/[0.02] p-1">
          {(["expense", "income", "transfer"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`rounded-md py-1.5 text-xs font-medium ${type === value ? "bg-accent/15 text-accent-text" : "text-muted-foreground"}`}
            >
              {TYPE_LABEL[value]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          {type === "transfer" ? "Со счёта" : "Счёт"}
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Выбирать при записи</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </label>
        {type === "transfer" ? (
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            На счёт
            <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">Выбирать при записи</option>
              {accounts.filter((account) => account.id !== accountId).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Категория
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Без категории</option>
              {categories.filter((category) => category.kind === kindOfType).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Сумма (пусто — спрашивать каждый раз)
          <Input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} placeholder="не задана" />
        </label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка к операции (по умолчанию — название)" maxLength={2000} />
        {error ? <p className="text-2xs text-destructive">{error}</p> : null}
        <div className="flex items-center justify-between gap-2">
          {template ? (
            <Button type="button" variant="danger" size="sm" onClick={() => void destroy()} disabled={remove.isPending}>
              Удалить
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="subtle" size="sm" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending || update.isPending}>
              Сохранить
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
