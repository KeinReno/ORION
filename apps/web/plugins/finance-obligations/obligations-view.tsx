"use client";

import {
  useAccounts,
  useCreateObligation,
  useDeleteObligation,
  useObligationPayments,
  useObligations,
  usePayObligation,
  useUpdateObligation
} from "@orion/core-react";
import { OBLIGATION_KIND_LABEL, OBLIGATION_KINDS, type CreateObligationInput, type Obligation, type ObligationInterval, type ObligationKind } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, DropdownMenu, EmptyState, IconButton, Input, Modal, Select, Skeleton, useContextMenuApi, useToast, type MenuItem } from "@orion/ui";
import { HandCoins, MoreHorizontal, Plus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { describeAuthError } from "../../lib/extensions/host-api";
import { dueState } from "../../lib/extensions/host-api";
import { formatMoney, fromKopecks, parseMoneyInput, shortDate, toKopecks } from "../../lib/extensions/host-api";
import type { FinanceTabSlotProps } from "../../lib/extensions/contracts";
import { useActiveWorkspace } from "../../lib/extensions/host-api";

const INTERVAL_LABEL: Record<ObligationInterval, string> = { once: "разово", monthly: "каждый месяц", yearly: "каждый год" };

interface FormValues {
  name: string;
  kind: ObligationKind;
  direction: "owe" | "owed";
  principal: string;
  payment: string;
  interval: ObligationInterval;
  nextDue: string;
  accountId: string;
  note: string;
  counterparty: string;
}

function emptyForm(): FormValues {
  return { name: "", kind: "debt", direction: "owe", principal: "", payment: "", interval: "monthly", nextDue: "", accountId: "", note: "", counterparty: "" };
}

function fromObligation(o: Obligation): FormValues {
  return {
    name: o.name,
    kind: o.kind,
    direction: o.direction,
    principal: o.principal === null ? "" : fromKopecks(o.principal),
    payment: fromKopecks(o.payment),
    interval: o.interval,
    nextDue: o.nextDueAt ? o.nextDueAt.slice(0, 10) : "",
    accountId: o.accountId ?? "",
    note: o.note,
    counterparty: o.counterparty
  };
}

/** The form's text → API input, or a message for the first thing that is wrong. */
export function toInput(values: FormValues): { ok: true; input: CreateObligationInput } | { ok: false; error: string } {
  const payment = toKopecks(values.payment);
  if (payment === null) return { ok: false, error: "Укажите плановый платёж больше нуля" };
  let principal: number | null = null;
  if (values.principal.trim()) {
    principal = parseMoneyInput(values.principal);
    if (principal === null || principal < 0) return { ok: false, error: "Остаток долга — число, например 120000" };
  }
  if (values.interval !== "once" && !values.nextDue) return { ok: false, error: "Для повторяющегося платежа нужен ближайший срок" };
  return {
    ok: true,
    input: {
      name: values.name.trim(),
      kind: values.kind,
      direction: values.direction,
      principal,
      payment,
      interval: values.interval,
      nextDueAt: values.nextDue ? new Date(`${values.nextDue}T09:00:00.000Z`).toISOString() : null,
      accountId: values.accountId || null,
      note: values.note.trim(),
      counterparty: values.counterparty.trim()
    }
  };
}

/**
 * Plugin `finance-obligations`: debts, credits, utility bills, subscriptions. The list is a PLAN — nothing here changes a
 * balance until you press «Оплатить», which records an ordinary operation in the account you confirm.
 */
export function ObligationsView({ workspaceId }: FinanceTabSlotProps): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const id = workspaceId ?? workspace?.id;
  const { data: obligations, isLoading } = useObligations(id);
  const { data: accounts } = useAccounts(id);
  const create = useCreateObligation(id);
  const update = useUpdateObligation(id);
  const remove = useDeleteObligation(id);
  const pay = usePayObligation(id);
  const { toast } = useToast();
  const showContextMenu = useContextMenuApi();

  const [editing, setEditing] = useState<{ obligation: Obligation | null; values: FormValues } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ obligation: Obligation; accountId: string; amount: string; partial: boolean } | null>(null);
  const [history, setHistory] = useState<Obligation | null>(null);
  const [deleting, setDeleting] = useState<Obligation | null>(null);

  const now = useMemo(() => new Date(), []);
  const open = (obligations ?? []).filter((o) => !o.closedAt).sort((a, b) => (a.nextDueAt ?? "9").localeCompare(b.nextDueAt ?? "9"));
  const closed = (obligations ?? []).filter((o) => o.closedAt);
  const owePerMonth = open.filter((o) => o.direction === "owe" && o.interval === "monthly").reduce((sum, o) => sum + o.payment, 0);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!editing) return;
    const parsed = toInput(editing.values);
    if (!parsed.ok) return setFormError(parsed.error);
    if (!editing.values.name.trim()) return setFormError("Укажите название");
    try {
      if (editing.obligation) await update.mutateAsync({ obligationId: editing.obligation.id, input: parsed.input });
      else await create.mutateAsync(parsed.input);
      setEditing(null);
      setFormError(null);
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      setFormError(describeAuthError(error));
    }
  }

  async function confirmPay(): Promise<void> {
    if (!paying || !paying.accountId) return;
    const amount = toKopecks(paying.amount);
    if (amount === null) return;
    try {
      await pay.mutateAsync({ obligationId: paying.obligation.id, input: { accountId: paying.accountId, amount, ...(paying.partial ? { partial: true } : {}) } });
      toast({ title: "Платёж записан в операции", tone: "success" });
      setPaying(null);
    } catch (error) {
      toast({ title: "Платёж не записан", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (isLoading) return <Skeleton className="h-32" />;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          План платежей: долги, кредиты, коммунальные, подписки. Баланс меняется только после «Оплатить».
          {owePerMonth > 0 ? ` Ежемесячно к оплате: ${formatMoney(owePerMonth)}.` : ""}
        </p>
        <Button size="sm" onClick={() => { setEditing({ obligation: null, values: emptyForm() }); setFormError(null); }}>
          <Plus className="h-4 w-4" /> Обязательство
        </Button>
      </div>

      {open.length === 0 && closed.length === 0 ? (
        <EmptyState icon={HandCoins} title="Обязательств пока нет" description="Добавьте кредит, долг или регулярный платёж — здесь появится ближайшее к оплате." />
      ) : null}

      <ul className="space-y-2">
        {open.map((o) => {
          const state = dueState(o.nextDueAt, now);
          const obligationMenuItems: (MenuItem | "separator")[] = [
            { label: "Изменить", onSelect: () => { setEditing({ obligation: o, values: fromObligation(o) }); setFormError(null); } },
            { label: "История платежей", onSelect: () => setHistory(o) },
            { label: "Закрыть", onSelect: () => void update.mutateAsync({ obligationId: o.id, input: { closedAt: new Date().toISOString() } }) },
            "separator",
            { label: "Удалить", tone: "danger", onSelect: () => setDeleting(o) }
          ];
          return (
            <li key={o.id}>
              <Card className="flex flex-wrap items-center gap-3 py-3" onContextMenu={(e) => showContextMenu(e, obligationMenuItems)}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {o.name}
                    {o.counterparty ? <span className="text-xs font-normal text-muted-foreground">· {o.counterparty}</span> : null}
                    <Badge tone="neutral">{OBLIGATION_KIND_LABEL[o.kind]}</Badge>
                    {o.direction === "owed" ? <Badge tone="success">мне должны</Badge> : null}
                    {state === "overdue" ? <Badge tone="danger">просрочено</Badge> : state === "soon" ? <Badge tone="warning">скоро</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatMoney(o.payment)} · {INTERVAL_LABEL[o.interval]}
                    {o.nextDueAt ? ` · срок ${shortDate(o.nextDueAt)}` : ""}
                    {o.principal !== null ? ` · осталось ${formatMoney(o.principal)}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setPaying({ obligation: o, accountId: o.accountId ?? "", amount: fromKopecks(o.payment), partial: false })}>
                  {o.direction === "owed" ? "Получено" : "Оплатить"}
                </Button>
                <DropdownMenu
                  align="end"
                  trigger={({ toggle }) => (
                    <IconButton label={`Действия: ${o.name}`} size="sm" onClick={toggle}>
                      <MoreHorizontal className="h-4 w-4" />
                    </IconButton>
                  )}
                  items={obligationMenuItems}
                />
              </Card>
            </li>
          );
        })}
      </ul>

      {closed.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Закрытые: {closed.length}</summary>
          <ul className="mt-2 space-y-1">
            {closed.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2">
                <span>{o.name}</span>
                <Button size="sm" variant="ghost" onClick={() => void update.mutateAsync({ obligationId: o.id, input: { closedAt: null } })}>
                  Открыть заново
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.obligation ? "Обязательство" : "Новое обязательство"} size="md">
        {editing ? (
          <form onSubmit={save} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Название
              <Input value={editing.values.name} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, name: e.target.value } })} maxLength={120} autoFocus />
            </label>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              С кем (человек, банк, магазин)
              <Input value={editing.values.counterparty} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, counterparty: e.target.value } })} maxLength={120} placeholder="не указано" />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-label text-subtle-foreground">
                Вид
                <Select value={editing.values.kind} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, kind: e.target.value as ObligationKind } })}>
                  {OBLIGATION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {OBLIGATION_KIND_LABEL[kind]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-label text-subtle-foreground">
                Кто платит
                <Select value={editing.values.direction} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, direction: e.target.value as "owe" | "owed" } })}>
                  <option value="owe">Я</option>
                  <option value="owed">Мне</option>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-label text-subtle-foreground">
                Как часто
                <Select value={editing.values.interval} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, interval: e.target.value as ObligationInterval } })}>
                  <option value="monthly">Каждый месяц</option>
                  <option value="yearly">Каждый год</option>
                  <option value="once">Один раз</option>
                </Select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-label text-subtle-foreground">
                Платёж
                <Input inputMode="decimal" value={editing.values.payment} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, payment: e.target.value } })} placeholder="15000" />
              </label>
              <label className="flex flex-col gap-1 text-label text-subtle-foreground">
                Остаток долга
                <Input inputMode="decimal" value={editing.values.principal} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, principal: e.target.value } })} placeholder="не вести" />
              </label>
              <label className="flex flex-col gap-1 text-label text-subtle-foreground">
                Ближайший срок
                <Input type="date" value={editing.values.nextDue} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, nextDue: e.target.value } })} />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Обычно платится со счёта
              <Select value={editing.values.accountId} onChange={(e) => setEditing({ ...editing, values: { ...editing.values, accountId: e.target.value } })}>
                <option value="">Выбирать при оплате</option>
                {(accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </label>
            {formError ? <p className="text-label text-destructive">{formError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="subtle" size="sm" onClick={() => setEditing(null)}>
                Отмена
              </Button>
              <Button type="submit" size="sm" disabled={create.isPending || update.isPending}>
                Сохранить
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal open={paying !== null} onClose={() => setPaying(null)} title={paying?.obligation.direction === "owed" ? "Получено" : "Оплатить"} size="sm">
        {paying ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">
              {paying.obligation.name}
              {paying.obligation.nextDueAt ? ` · срок ${shortDate(paying.obligation.nextDueAt)}` : ""}
            </p>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Счёт (подтвердите)
              <Select value={paying.accountId} onChange={(e) => setPaying({ ...paying, accountId: e.target.value })}>
                <option value="">Выберите счёт…</option>
                {(accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.currency}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Сумма
              <Input inputMode="decimal" value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: e.target.value })} />
            </label>
            {paying.obligation.principal !== null ? (
              <label className="flex items-start gap-2 text-label text-muted-foreground">
                <input type="checkbox" className="mt-0.5" checked={paying.partial} onChange={(e) => setPaying({ ...paying, partial: e.target.checked })} />
                <span>Частичное погашение: уменьшить остаток, срок и график не трогать</span>
              </label>
            ) : null}
            <p className="text-micro text-subtle-foreground">
              В операциях появится {paying.obligation.direction === "owed" ? "доход" : "расход"}
              {paying.partial ? "; остаток уменьшится, срок останется прежним." : "; срок сдвинется на следующий период."}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="subtle" size="sm" onClick={() => setPaying(null)}>
                Отмена
              </Button>
              <Button size="sm" disabled={!paying.accountId || pay.isPending} onClick={() => void confirmPay()}>
                Записать
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={history !== null} onClose={() => setHistory(null)} title={history ? `Платежи: ${history.name}` : "Платежи"} size="sm">
        {history ? <PaymentHistory workspaceId={id} obligation={history} accountName={(accountId) => accounts?.find((a) => a.id === accountId)?.name ?? "—"} /> : null}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Удалить обязательство?"
        description={deleting ? `«${deleting.name}» — уже записанные платежи останутся в операциях.` : undefined}
        confirmLabel="Удалить"
        onConfirm={() => {
          if (deleting) void remove.mutateAsync(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/** Payments recorded against one obligation, with what is still left. They are ordinary operations: editing them is done in «Транзакции». */
function PaymentHistory({ workspaceId, obligation, accountName }: { workspaceId: string | undefined; obligation: Obligation; accountName: (accountId: string) => string }): React.ReactElement {
  const { data, isLoading } = useObligationPayments(workspaceId, obligation.id);
  if (isLoading) return <Skeleton className="h-20" />;
  const payments = data ?? [];
  const paid = payments.reduce((sum, payment) => sum + payment.totalAmount, 0);
  if (payments.length === 0) return <p className="text-sm text-muted-foreground">Платежей по этому обязательству ещё не записано.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Записано платежей: {payments.length}, на {formatMoney(paid)}
        {obligation.principal !== null ? ` · осталось ${formatMoney(obligation.principal)}` : ""}
        {obligation.counterparty ? ` · ${obligation.counterparty}` : ""}
      </p>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {payments.map((payment) => (
          <li key={payment.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {shortDate(payment.occurredAt)} · {accountName(payment.accountId)}
            </span>
            <span className="font-mono tabular-nums text-foreground">
              {payment.type === "income" ? "+" : "−"}
              {formatMoney(payment.totalAmount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
