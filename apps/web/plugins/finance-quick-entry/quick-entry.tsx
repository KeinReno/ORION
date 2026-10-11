"use client";

import { useAccounts, useCreateTransaction, useFinanceCategories } from "@orion/core-react";
import { Button, Card, Input, Select, useToast } from "@orion/ui";
import { Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { FinanceTransactionsTopSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError } from "../../lib/extensions/host-api";
import { parseQuickEntry, type QuickEntryDraft } from "../../lib/extensions/host-api";
import { formatMoney } from "../../lib/extensions/host-api";

function dateInput(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Plugin `finance-quick-entry`: a one-line field above the operations («-500 хлеб #еда @вчера»). What you type becomes a
 * DRAFT that you confirm: the account is always chosen by you, the direction too when the text had no «−»/«+», the
 * category is only suggested (by the last word of the note). Nothing is written until «Записать».
 */
export function QuickEntry({ workspaceId }: FinanceTransactionsTopSlotProps): React.ReactElement {
  const { data: accounts } = useAccounts(workspaceId);
  const { data: categories } = useFinanceCategories(workspaceId);
  const create = useCreateTransaction(workspaceId);
  const { toast } = useToast();

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuickEntryDraft | null>(null);
  const [direction, setDirection] = useState<"" | "expense" | "income">("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState("");

  function understand(event: FormEvent): void {
    event.preventDefault();
    const result = parseQuickEntry(text);
    if (!result.ok) {
      setError(result.error);
      setDraft(null);
      return;
    }
    setError(null);
    const parsed = result.draft;
    setDraft(parsed);
    setDirection(parsed.direction ?? "");
    setNote(parsed.note);
    setDay(dateInput(parsed.date ?? new Date()));
    setAccountId("");
    // A suggestion, nothing more: same-named category of the right kind, only once the direction is known.
    const kind = parsed.direction;
    const hinted = kind ? categories?.find((category) => category.kind === kind && category.name.trim().toLowerCase() === parsed.categoryHint) : undefined;
    setCategoryId(hinted?.id ?? "");
  }

  function cancel(): void {
    setDraft(null);
    setError(null);
  }

  async function save(): Promise<void> {
    if (!draft || !direction || !accountId) return;
    const [y, m, d] = day.split("-").map(Number);
    try {
      await create.mutateAsync({
        accountId,
        type: direction,
        note: note.trim(),
        tags: draft.tags,
        occurredAt: new Date(y!, m! - 1, d!, 12, 0, 0, 0).toISOString(),
        lines: [{ categoryId: categoryId || null, amount: draft.amountMinor }]
      });
      toast({ title: "Операция записана", tone: "success" });
      setText("");
      setDraft(null);
    } catch (e) {
      toast({ title: "Не удалось записать", description: describeAuthError(e), tone: "danger" });
    }
  }

  const account = accounts?.find((item) => item.id === accountId);
  const kindCategories = (categories ?? []).filter((category) => category.kind === direction);
  const ready = Boolean(draft && direction && accountId && day);

  return (
    <Card className="space-y-3 py-3">
      <form onSubmit={understand} className="flex items-center gap-2">
        <Zap className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Быстрая запись: -500 хлеб #еда @вчера"
          aria-label="Быстрая запись операции"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!text.trim()}>
          Разобрать
        </Button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {draft ? (
        <div className="space-y-3 rounded-xl border border-border bg-white/[0.02] p-3">
          <p className="text-sm text-foreground">
            Сумма: <strong className="font-mono">{formatMoney(draft.amountMinor, account?.currency ?? "RUB")}</strong>
            {draft.tags.length ? <span className="text-muted-foreground"> · теги: {draft.tags.map((tag) => `#${tag}`).join(" ")}</span> : null}
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Что это
              <Select value={direction} onChange={(event) => { setDirection(event.target.value as typeof direction); setCategoryId(""); }}>
                <option value="">Выберите…</option>
                <option value="expense">Расход</option>
                <option value="income">Доход</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Счёт
              <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">Выберите счёт…</option>
                {(accounts ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.currency}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Категория
              <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={!direction}>
                <option value="">Без категории</option>
                {kindCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Дата
              <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Описание
            <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
          </label>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!ready || create.isPending} onClick={() => void save()}>
              Записать
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Отмена
            </Button>
            {!ready ? <span className="text-xs text-subtle-foreground">Выберите {direction ? "счёт" : "расход или доход и счёт"}</span> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
