"use client";

import { useAccounts, usePutUtilityPayment, useRemoveUtilityPayment, useTransactions } from "@orion/core-react";
import type { UtilityMonth } from "@orion/shared-types";
import { Button, Card, Input, Select, useToast } from "@orion/ui";
import { useState } from "react";

const money = (minor: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(minor / 100);
const inputMoney = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");
function parseMoney(value: string): number | null {
  const clean = value.trim().replace(/\s/g, "").replace(",", ".");
  return /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : null;
}

export function UtilityPayments({ workspaceId, homeId, month }: { workspaceId: string | undefined; homeId: string; month: UtilityMonth }): React.ReactElement {
  const { toast } = useToast();
  const { data: transactions, isError: transactionsError } = useTransactions(workspaceId, { limit: 100 });
  const { data: accounts } = useAccounts(workspaceId, true);
  const put = usePutUtilityPayment(workspaceId, homeId);
  const remove = useRemoveUtilityPayment(workspaceId, homeId);
  const [transactionId, setTransactionId] = useState("");
  const [amount, setAmount] = useState("");
  const candidates = (transactions ?? []).filter((transaction) => transaction.type === "expense" && accounts?.some((account) => account.id === transaction.accountId && account.currency === "RUB"));
  const paid = month.paidMinor ?? 0;
  const remaining = month.remainingMinor ?? month.confirmedTotalMinor;
  const invalid = month.payments.filter((payment) => !payment.valid);

  async function link(): Promise<void> {
    const amountMinor = parseMoney(amount);
    if (!transactionId || amountMinor === null || amountMinor <= 0) return;
    try {
      await put.mutateAsync({ period: month.period, input: { transactionId, amountMinor } });
      setTransactionId(""); setAmount("");
      toast({ title: "Оплата связана с месяцем", tone: "success" });
    } catch (error) { toast({ title: "Не удалось связать оплату", description: String(error), tone: "danger" }); }
  }

  async function unlink(paymentId: string): Promise<void> {
    try { await remove.mutateAsync({ period: month.period, paymentId }); toast({ title: "Связь оплаты удалена", tone: "success" }); }
    catch (error) { toast({ title: "Не удалось отвязать оплату", description: String(error), tone: "danger" }); }
  }

  return <Card className="space-y-3 p-4">
    <div><h4 className="text-title">Оплата месяца</h4><p className="text-2xs text-muted-foreground">Подтверждено {money(month.confirmedTotalMinor)} · оплачено {money(paid)} · осталось {money(remaining)}</p></div>
    {invalid.length ? <p role="alert" className="text-2xs text-warning">{invalid.length} связанная операция изменилась или сумма начислений уменьшилась. Проверьте привязки: они не включены в «оплачено».</p> : null}
    {month.payments.length ? <div className="space-y-1">{month.payments.map((payment) => <div key={payment.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2 text-label"><span className="min-w-0 flex-1 truncate">{payment.note || (payment.occurredAt ? new Date(payment.occurredAt).toLocaleDateString("ru-RU") : "Операция")}{!payment.valid ? " · нужна проверка" : ""}</span><strong className="tabular-nums">{money(payment.amountMinor)}</strong><Button size="sm" variant="subtle" onClick={() => void unlink(payment.id)} disabled={remove.isPending}>Отвязать</Button></div>)}</div> : <p className="text-2xs text-subtle-foreground">Оплат пока не привязано.</p>}
    <div className="grid gap-2 border-t border-border/70 pt-3 [@container(min-width:680px)]:grid-cols-[minmax(0,1fr)_8rem_auto]">
      <label className="text-2xs text-muted-foreground">Расход из «Финансов»<Select className="mt-1" value={transactionId} onChange={(event) => { const id = event.target.value; setTransactionId(id); const selected = candidates.find((item) => item.id === id); setAmount(selected ? inputMoney(Math.min(remaining, selected.totalAmount)) : ""); }}><option value="">Выберите операцию…</option>{candidates.map((item) => <option key={item.id} value={item.id}>{new Date(item.occurredAt).toLocaleDateString("ru-RU")} · {item.note || "Расход"} · {money(item.totalAmount)}</option>)}</Select></label>
      <label className="text-2xs text-muted-foreground">Сумма, ₽<Input className="mt-1" value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} /></label>
      <div className="self-end"><Button size="sm" onClick={() => void link()} disabled={!transactionId || !parseMoney(amount) || put.isPending || month.confirmedTotalMinor === 0}>Связать</Button></div>
    </div>
    {transactionsError ? <p className="text-2xs text-destructive">Не удалось загрузить финансовые операции.</p> : null}
    <p className="text-2xs text-subtle-foreground">Привязка не создаёт нового расхода. В списке последние 100 операций; сначала запишите платёж в «Финансах».</p>
  </Card>;
}
