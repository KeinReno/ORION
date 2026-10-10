"use client";

import type { Account, CategoryRule, FinanceCategory, Transaction, TransactionType } from "@orion/shared-types";
import { Button, IconButton, Input, Select, Textarea } from "@orion/ui";
import { ArrowRight, Plus, X, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { formatMoney, fromDatetimeLocal, fromKopecks, relativeTime, toDatetimeLocal, toKopecks } from "../../lib/format";

export interface TransactionFormValues {
  accountId: string;
  toAccountId: string | null;
  type: TransactionType;
  note: string;
  tags: string[];
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
 * docs/PLAN.md v0.9 — a transfer is just a transaction with one
 * uncategorised line, not a separate code path bolted on.
 */
export function TransactionForm({
  initial,
  accounts,
  categories,
  categoryRules,
  defaultAccountId,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete
}: {
  initial?: Transaction;
  accounts: Account[];
  categories: FinanceCategory[];
  /** v0.13 auto-categorization — matched against the note field, applied only here, never server-side. */
  categoryRules?: CategoryRule[];
  defaultAccountId?: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: TransactionFormValues) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}): React.ReactElement {
  const [type, setType] = useState<TransactionType>(initial?.type ?? "expense");
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? "");
  const [transferAmount, setTransferAmount] = useState(
    fromKopecks(initial?.type === "transfer" ? initial.totalAmount : undefined)
  );
  const [lines, setLines] = useState<LineDraft[]>(
    initial && initial.type !== "transfer" && initial.lines.length > 0
      ? initial.lines.map((l) => toLineDraft(l.categoryId, l.amount))
      : [toLineDraft(null, 0)]
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [occurredAt, setOccurredAt] = useState(toDatetimeLocal(initial?.occurredAt ?? new Date().toISOString()));
  const [error, setError] = useState<string | null>(null);
  // Only auto-fills the first line's category while the user hasn't picked one themselves.
  const [categoryAutoFilled, setCategoryAutoFilled] = useState(!initial);

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

  function addTag(): void {
    const value = tagDraft.trim();
    if (!value || tags.includes(value)) {
      setTagDraft("");
      return;
    }
    setTags((cur) => [...cur, value]);
    setTagDraft("");
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    } else if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
      setTags((cur) => cur.slice(0, -1));
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
            <label className="flex flex-1 flex-col gap-1 text-2xs text-subtle-foreground">
              Со счёта
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </label>
            <ArrowRight className="mt-4 h-4 w-4 shrink-0 text-subtle-foreground" />
            <label className="flex flex-1 flex-col gap-1 text-2xs text-subtle-foreground">
              На счёт
              <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
                <option value="" disabled>
                  Выберите счёт
                </option>
                {toAccountOptions.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Сумма, ₽
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
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Счёт
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </label>

          <div className="flex flex-col gap-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-start gap-2">
                <Select
                  value={line.categoryId}
                  onChange={(e) => updateLine(index, { categoryId: e.target.value })}
                  className="flex-1"
                >
                  <option value="">Без категории</option>
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
                <Input
                  inputMode="decimal"
                  placeholder="Сумма, ₽"
                  value={line.amountText}
                  onChange={(e) => {
                    updateLine(index, { amountText: e.target.value });
                    setError(null);
                  }}
                  className="w-28 shrink-0"
                  autoFocus={index === 0}
                />
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

      {error ? <p className="text-2xs text-destructive">{error}</p> : null}

      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Дата
        <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </label>

      <Textarea
        placeholder="Заметка (необязательно)"
        rows={2}
        value={note}
        onChange={(e) => handleNoteChange(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-white/[0.02] px-2 py-1.5">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground">
            {tag}
            <button type="button" onClick={() => setTags((cur) => cur.filter((t) => t !== tag))} aria-label={`Убрать тег ${tag}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={handleTagKeyDown}
          onBlur={addTag}
          placeholder={tags.length === 0 ? "Теги (Enter)" : ""}
          className="min-w-[6rem] flex-1 bg-transparent text-2xs text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </div>

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
