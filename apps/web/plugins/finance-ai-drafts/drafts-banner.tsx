"use client";

import { useAccounts, useAcceptFinanceDraft, useFinanceCategories, useFinanceDrafts, useRejectFinanceDraft } from "@orion/core-react";
import type { FinanceDraft } from "@orion/shared-types";
import { Button, Input, Modal, Select, useToast } from "@orion/ui";
import { Bot } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { FinanceTransactionsTopSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError, formatMoney, fromDatetimeLocal, fromKopecks, shortDate, toDatetimeLocal, toKopecks } from "../../lib/extensions/host-api";

/**
 * Plugin `finance-ai-drafts`: «ИИ предлагает». An external agent read a receipt and PROPOSED an operation. Nothing is
 * written until you confirm: you see what it read, can correct every field, and only «Записать» creates the operation.
 * «Отклонить» discards the draft. The agent never writes anything by itself.
 */
export function DraftsBanner({ workspaceId }: FinanceTransactionsTopSlotProps): React.ReactElement | null {
  const { data: drafts } = useFinanceDrafts(workspaceId);
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState<FinanceDraft | null>(null);
  const pending = useMemo(() => (drafts ?? []).filter((draft) => draft.status === "pending"), [drafts]);
  if (pending.length === 0) return null;

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-xs text-foreground">
        <Bot className="h-4 w-4 shrink-0 text-accent-text" aria-hidden />
        <span className="flex-1">ИИ предлагает операций: {pending.length}. Пока вы не подтвердите, ничего не записано.</span>
        <span className="text-accent-text">{open ? "Скрыть" : "Показать"}</span>
      </button>
      {open ? (
        <ul className="mt-2 space-y-1.5">
          {pending.map((draft) => (
            <li key={draft.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 text-muted-foreground">
                <span className="text-foreground">{draft.merchant || draft.note || "Без описания"}</span> · {shortDate(draft.occurredAt)} ·{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {draft.type === "income" ? "+" : "−"}
                  {formatMoney(draft.amount, draft.currency ?? "RUB")}
                </span>{" "}
                · от «{draft.tokenName}»
              </span>
              <Button size="sm" variant="outline" onClick={() => setReviewing(draft)}>
                Проверить
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {reviewing ? <ReviewModal workspaceId={workspaceId} draft={reviewing} onClose={() => setReviewing(null)} /> : null}
    </div>
  );
}

function ReviewModal({ workspaceId, draft, onClose }: { workspaceId: string | undefined; draft: FinanceDraft; onClose: () => void }): React.ReactElement {
  const { data: accounts } = useAccounts(workspaceId);
  const { data: categories } = useFinanceCategories(workspaceId);
  const accept = useAcceptFinanceDraft(workspaceId);
  const reject = useRejectFinanceDraft(workspaceId);
  const { toast } = useToast();
  const activeAccounts = useMemo(() => (accounts ?? []).filter((account) => !account.archivedAt), [accounts]);

  const [type, setType] = useState<"expense" | "income">(draft.type);
  // The agent's account hint is only a hint: it must still exist; otherwise prefer an account in the receipt's currency.
  const initialAccount =
    activeAccounts.find((account) => account.id === draft.accountId)?.id ??
    (draft.currency ? activeAccounts.find((account) => account.currency === draft.currency)?.id : undefined) ??
    "";
  const [accountId, setAccountId] = useState(initialAccount);
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? "");
  const [amount, setAmount] = useState(fromKopecks(draft.amount));
  const [when, setWhen] = useState(toDatetimeLocal(draft.occurredAt));
  const [note, setNote] = useState([draft.merchant, draft.note].filter(Boolean).join(" — "));
  const [error, setError] = useState<string | null>(null);

  const account = activeAccounts.find((item) => item.id === accountId);
  const currencyMismatch = Boolean(account && draft.currency && account.currency !== draft.currency);
  const categoryOptions = (categories ?? []).filter((category) => !category.archivedAt && category.kind === type);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const kopecks = toKopecks(amount);
    if (!kopecks) return setError("Введите сумму больше нуля");
    if (!accountId) return setError("Выберите счёт");
    try {
      await accept.mutateAsync({
        draftId: draft.id,
        input: {
          accountId,
          toAccountId: null,
          type,
          note: note.trim(),
          tags: [],
          occurredAt: fromDatetimeLocal(when) ?? new Date().toISOString(),
          lines: [{ categoryId: categoryId || null, amount: kopecks }]
        }
      });
      toast({ title: "Операция записана", tone: "success" });
      onClose();
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  async function discard(): Promise<void> {
    try {
      await reject.mutateAsync(draft.id);
      toast({ title: "Черновик отклонён", tone: "default" });
      onClose();
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Проверьте операцию"
      description={`Предложил(а) «${draft.tokenName}»${draft.sourceNote ? ` · ${draft.sourceNote}` : ""}${draft.confidence !== null ? ` · уверенность ${Math.round(draft.confidence * 100)}%` : ""}. Исправьте, что нужно.`}
      size="sm"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-white/[0.02] p-1">
          {(["expense", "income"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setType(value); setCategoryId(""); }}
              className={`rounded-md py-1.5 text-xs font-medium ${type === value ? "bg-accent/15 text-accent-text" : "text-muted-foreground"}`}
            >
              {value === "expense" ? "Расход" : "Доход"}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Счёт
          <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setError(null); }} required>
            <option value="">Выберите счёт…</option>
            {activeAccounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.currency}
              </option>
            ))}
          </Select>
        </label>
        {currencyMismatch ? <p className="text-2xs text-warning">В чеке валюта {draft.currency}, а у счёта {account?.currency}: проверьте сумму — пересчёта нет.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Сумма
            <Input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Категория
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Без категории</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Когда
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Заметка
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
        {error ? <p className="text-2xs text-destructive">{error}</p> : null}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="danger" size="sm" onClick={() => void discard()} disabled={reject.isPending || accept.isPending}>
            Отклонить
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="subtle" size="sm" onClick={onClose}>
              Позже
            </Button>
            <Button type="submit" size="sm" disabled={accept.isPending}>
              Записать
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
