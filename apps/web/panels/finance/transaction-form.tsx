"use client";

import type { Account, CategoryRule, FinanceCategory, Project, Transaction, TransactionType } from "@orion/shared-types";
import { Alert, Button, Combobox, Field, IconButton, Input, InputGroup, TagsInput, Textarea } from "@orion/ui";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { formatMoney, fromDatetimeLocal, fromKopecks, relativeTime, toDatetimeLocal, toKopecks } from "../../lib/format";

export interface TransactionFormValues {
  accountId: string;
  toAccountId: string | null;
  type: TransactionType;
  note: string;
  tags: string[];
  /** null = не относится к проекту. */
  projectId: string | null;
  occurredAt: string;
  lines: { categoryId: string | null; amount: number }[];
}

interface LineDraft {
  categoryId: string;
  amountText: string;
}

function toLineDraft(categoryId: string | null, amount: number): LineDraft {
  return { categoryId: categoryId ?? "", amountText: fromKopecks(amount) };
}

/**
 * v0.9: a 3-way type switch (was 2 — expense/income), a repeatable list of
 * category+amount lines (split), and a transfer mode (no category, a
 * second "to account" select instead). See TransactionFormValues and
 * docs/HISTORY.md v0.9 — a transfer is just a transaction with one
 * uncategorised line, not a separate code path bolted on.
 */
export function TransactionForm({
  initial,
  copyOf,
  accounts,
  categories,
  categoryRules,
  projects,
  defaultAccountId,
  defaultProjectId,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete
}: {
  initial?: Transaction;
  /** «Дублировать»: поля берутся отсюда, но это новая операция — с текущей датой. */
  copyOf?: Transaction;
  accounts: Account[];
  categories: FinanceCategory[];
  /** v0.13 auto-categorization — matched against the note field, applied only here, never server-side. */
  categoryRules?: CategoryRule[];
  /** Проекты для выбора; без списка (модуль «Проекты» выключен) поле не показывается. */
  projects?: Project[];
  defaultAccountId?: string;
  defaultProjectId?: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: TransactionFormValues) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}): React.ReactElement {
  const seed = initial ?? copyOf;
  const [type, setType] = useState<TransactionType>(seed?.type ?? "expense");
  const [accountId, setAccountId] = useState(seed?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(seed?.toAccountId ?? "");
  const [transferAmount, setTransferAmount] = useState(
    fromKopecks(seed?.type === "transfer" ? seed.totalAmount : undefined)
  );
  const [lines, setLines] = useState<LineDraft[]>(
    seed && seed.type !== "transfer" && seed.lines.length > 0
      ? seed.lines.map((l) => toLineDraft(l.categoryId, l.amount))
      : [toLineDraft(null, 0)]
  );
  const [note, setNote] = useState(seed?.note ?? "");
  const [tags, setTags] = useState<string[]>(seed?.tags ?? []);
  const [projectId, setProjectId] = useState(seed?.projectId ?? defaultProjectId ?? "");
  const [occurredAt, setOccurredAt] = useState(toDatetimeLocal(initial?.occurredAt ?? new Date().toISOString()));
  const [error, setError] = useState<string | null>(null);
  // Only auto-fills the first line's category while the user hasn't picked one themselves.
  const [categoryAutoFilled, setCategoryAutoFilled] = useState(!seed);

  const categoryOptions = useMemo(
    () => categories.filter((c) => c.kind === (type === "income" ? "income" : "expense")),
    [categories, type]
  );
  const toAccountOptions = useMemo(() => accounts.filter((a) => a.id !== accountId), [accounts, accountId]);

  function setType3(next: TransactionType): void {
    setType(next);
    setError(null);
    if (next === "transfer" && !toAccountId) {
      setToAccountId(toAccountOptions[0]?.id ?? "");
    }
  }

  function updateLine(index: number, patch: Partial<LineDraft>): void {
    if (index === 0 && "categoryId" in patch) setCategoryAutoFilled(false);
    setLines((cur) => cur.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function handleNoteChange(value: string): void {
    setNote(value);
    if (type === "transfer" || !categoryAutoFilled || !categoryRules?.length) return;
    const lower = value.toLowerCase();
    const match = categoryRules.find((rule) => lower.includes(rule.matchText.toLowerCase()));
    if (match) {
      setLines((cur) => (cur.length > 0 ? cur.map((line, i) => (i === 0 ? { ...line, categoryId: match.categoryId } : line)) : cur));
    }
  }

  function addLine(): void {
    setLines((cur) => [...cur, toLineDraft(null, 0)]);
  }

  function removeLine(index: number): void {
    setLines((cur) => cur.filter((_, i) => i !== index));
  }

  const linesTotal = useMemo(() => lines.reduce((sum, line) => sum + (toKopecks(line.amountText) ?? 0), 0), [lines]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!accountId) return;

    if (type === "transfer") {
      const amount = toKopecks(transferAmount);
      if (!amount) {
        setError("Введите сумму перевода больше нуля");
        return;
      }
      if (!toAccountId) {
        setError("Выберите счёт назначения");
        return;
      }
      void onSubmit({
        accountId,
        toAccountId,
        type,
        note,
        tags,
        projectId: projectId || null,
        occurredAt: fromDatetimeLocal(occurredAt) ?? new Date().toISOString(),
        lines: [{ categoryId: null, amount }]
      });
      return;
    }

    const parsedLines: { categoryId: string | null; amount: number }[] = [];
    for (const line of lines) {
      const amount = toKopecks(line.amountText);
      if (!amount) {
        setError("Каждая строка должна иметь сумму больше нуля");
        return;
      }
      parsedLines.push({ categoryId: line.categoryId || null, amount });
    }
    if (parsedLines.length === 0) {
      setError("Нужна хотя бы одна строка");
      return;
    }
    void onSubmit({
      accountId,
      toAccountId: null,
      type,
      note,
      tags,
      projectId: projectId || null,
      occurredAt: fromDatetimeLocal(occurredAt) ?? new Date().toISOString(),
      lines: parsedLines
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-white/[0.02] p-1">
        {(["expense", "income", "transfer"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType3(t)}
            className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
              type === t
                ? t === "expense"
                  ? "bg-destructive/15 text-destructive"
                  : t === "income"
                    ? "bg-success/15 text-success"
                    : "bg-accent/15 text-accent-text"
                : "text-muted-foreground"
            }`}
          >
            {t === "expense" ? "Расход" : t === "income" ? "Доход" : "Перевод"}
          </button>
        ))}
      </div>

      {type === "transfer" ? (
        <>
          <div className="flex items-center gap-2">
            <Field label="Со счёта" className="min-w-0 flex-1">
              <Combobox label="Со счёта" items={accounts.map((account) => ({ id: account.id, label: account.name }))} value={accountId} onChange={setAccountId} />
            </Field>
            <ArrowRight className="mt-4 h-4 w-4 shrink-0 text-subtle-foreground" />
            <Field label="На счёт" className="min-w-0 flex-1">
              <Combobox label="На счёт" items={toAccountOptions.map((account) => ({ id: account.id, label: account.name }))} value={toAccountId || null} onChange={setToAccountId} placeholder="Выберите счёт" />
            </Field>
          </div>
          <Field label="Сумма">
            <InputGroup suffix="₽">
              <Input
                inputMode="decimal"
                placeholder="0"
                value={transferAmount}
                onChange={(e) => {
                  setTransferAmount(e.target.value);
                  setError(null);
                }}
                autoFocus
              />
            </InputGroup>
          </Field>
        </>
      ) : (
        <>
          <Field label="Счёт">
            <Combobox label="Счёт" items={accounts.map((account) => ({ id: account.id, label: account.name }))} value={accountId} onChange={setAccountId} />
          </Field>

          <div className="flex flex-col gap-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                <Combobox
                  label="Категория"
                  items={[{ id: "", label: "Без категории" }, ...categoryOptions.map((category) => ({ id: category.id, label: category.name }))]}
                  value={line.categoryId}
                  onChange={(categoryId) => updateLine(index, { categoryId })}
                />
                </div>
                <InputGroup suffix="₽" className="w-32 shrink-0">
                  <Input
                    inputMode="decimal"
                    placeholder="Сумма"
                    value={line.amountText}
                    onChange={(e) => {
                      updateLine(index, { amountText: e.target.value });
                      setError(null);
                    }}
                    autoFocus={index === 0}
                  />
                </InputGroup>
                {lines.length > 1 ? (
                  <IconButton label="Убрать строку" size="md" tone="danger" onClick={() => removeLine(index)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                ) : null}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 text-2xs font-medium text-accent-text hover:text-accent-hover"
              >
                <Plus className="h-3.5 w-3.5" /> Разбить по категориям
              </button>
              {lines.length > 1 ? (
                <span className="text-2xs text-subtle-foreground">Итого: {formatMoney(linesTotal)}</span>
              ) : null}
            </div>
          </div>
        </>
      )}

      {error ? <Alert tone="danger" title={error} /> : null}

      <Field label="Дата">
        <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </Field>

      {projects ? (
        <Field label="Проект">
          <Combobox
            label="Проект"
            items={[{ id: "", label: "Без проекта" }, ...projects.map((project) => ({ id: project.id, label: project.name }))]}
            value={projectId}
            onChange={setProjectId}
          />
        </Field>
      ) : null}

      <Textarea
        placeholder="Заметка (необязательно)"
        rows={2}
        value={note}
        onChange={(e) => handleNoteChange(e.target.value)}
      />

      <TagsInput label="Теги" value={tags} onChange={setTags} />

      {initial ? (
        <p className="text-2xs text-subtle-foreground">
          Создано {relativeTime(initial.createdAt)} · изменено {relativeTime(initial.updatedAt)}
        </p>
      ) : null}

      <div className="mt-1 flex items-center justify-between gap-2">
        {onDelete ? (
          <Button type="button" variant="danger" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Удалить
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={busy || !accountId}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
