"use client";

import { useAccounts, useFinanceCategories, useRecordListExpense } from "@orion/core-react";
import { listProgress } from "@orion/shared-types";
import { Button, CheckToggle, Input, Modal, Select, useToast } from "@orion/ui";
import { Wallet } from "lucide-react";
import { useState } from "react";
import type { ListsActionsSlotProps, ListsItemMarkSlotProps } from "../../lib/extensions/contracts";
import { describeError, formatMoney, fromKopecks, openEntity, parseMoneyInput, useEnabledModules } from "../../lib/extensions/host-api";

/**
 * Plugin «Покупки → Финансы», the list side (ADR-0009). «Записать расход» turns the bought entries into ONE
 * expense — a receipt is one payment — and marks each entry with the transaction, so the same entry is never
 * booked twice. The amount is the sum of the entries' prices, or the receipt total typed in.
 */
export function RecordExpenseAction({ workspaceId, list }: ListsActionsSlotProps): React.ReactElement | null {
  const { isEnabled } = useEnabledModules();
  const [open, setOpen] = useState(false);
  const bookable = list.items.filter((item) => item.checked && !item.expenseTransactionId);
  if (!isEnabled("finance") || list.isTemplate || bookable.length === 0) return null;
  return (
    <>
      <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>
        <Wallet className="h-4 w-4" aria-hidden /> Записать расход
      </Button>
      {open ? <ExpenseDialog workspaceId={workspaceId} list={list} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ExpenseDialog({ workspaceId, list, onClose }: ListsActionsSlotProps & { onClose: () => void }): React.ReactElement {
  const accounts = useAccounts(workspaceId);
  const categories = useFinanceCategories(workspaceId);
  const record = useRecordListExpense(workspaceId);
  const { toast } = useToast();

  const bookable = list.items.filter((item) => item.checked && !item.expenseTransactionId);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(bookable.map((item) => item.id)));
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const chosen = bookable.filter((item) => picked.has(item.id));
  const priced = listProgress(chosen);
  const [amount, setAmount] = useState(() => (priced.unpriced === 0 && priced.priceMinor > 0 ? fromKopecks(priced.priceMinor) : ""));
  const [amountTouched, setAmountTouched] = useState(false);

  const expenseCategories = (categories.data ?? []).filter((category) => category.kind === "expense");
  const accountList = accounts.data ?? [];
  const effectiveAccountId = accountId || accountList[0]?.id || "";
  const account = accountList.find((candidate) => candidate.id === effectiveAccountId);
  const parsed = parseMoneyInput(amount);
  const amountMinor = parsed !== null && parsed > 0 ? parsed : null;
  const ready = chosen.length > 0 && effectiveAccountId !== "" && amountMinor !== null;

  function toggle(id: string): void {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Follow the prices until the user types the receipt total by hand.
      if (!amountTouched) {
        const sum = listProgress(bookable.filter((item) => next.has(item.id)));
        setAmount(sum.unpriced === 0 && sum.priceMinor > 0 ? fromKopecks(sum.priceMinor) : "");
      }
      return next;
    });
  }

  function submit(): void {
    if (!ready || amountMinor === null) return;
    record.mutate(
      {
        listId: list.id,
        input: {
          itemIds: chosen.map((item) => item.id),
          accountId: effectiveAccountId,
          categoryId: categoryId || null,
          amountMinor
        }
      },
      {
        onSuccess: (result) => {
          toast({
            title: `Расход записан: ${formatMoney(result.amountMinor, account?.currency)}`,
            action: { label: "Открыть", onClick: () => openEntity("transaction", result.transactionId) },
            tone: "success"
          });
          onClose();
        },
        onError: (error) => toast({ title: "Не удалось записать расход", description: describeError(error), tone: "danger" })
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Записать расход"
      description={`Купленное по списку «${list.name}» запишется одной операцией — как чек.`}
      footer={
        <>
          <Button variant="subtle" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button size="sm" onClick={submit} disabled={!ready || record.isPending}>
            Записать
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {bookable.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <CheckToggle checked={picked.has(item.id)} onClick={() => toggle(item.id)} label={item.label} size="sm" shape="square" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.priceMinor !== null ? formatMoney(item.priceMinor, account?.currency) : "—"}</span>
            </li>
          ))}
        </ul>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Сумма чека, {account?.currency ?? "₽"}</span>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmountTouched(true);
              setAmount(e.target.value);
            }}
            placeholder={priced.unpriced > 0 ? "У части пунктов нет цены — введите сумму" : "0"}
            aria-invalid={amount.trim() !== "" && amountMinor === null}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Со счёта</span>
            <Select value={effectiveAccountId} onChange={(e) => setAccountId(e.target.value)} disabled={accountList.length === 0}>
              {accountList.length === 0 ? <option value="">Нет счетов</option> : null}
              {accountList.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Категория</span>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Без категории</option>
              {expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>
    </Modal>
  );
}

/** A small mark next to an entry that is already booked; it opens the expense. */
export function ExpenseMark({ item }: ListsItemMarkSlotProps): React.ReactElement | null {
  if (!item.expenseTransactionId) return null;
  const transactionId = item.expenseTransactionId;
  return (
    <button
      type="button"
      onClick={() => openEntity("transaction", transactionId)}
      title="Записано в финансах — открыть операцию"
      aria-label="Записано в финансах"
      className="inline-flex shrink-0 items-center rounded-md border border-border p-1 text-success hover:bg-white/5"
    >
      <Wallet className="h-3 w-3" aria-hidden />
    </button>
  );
}
