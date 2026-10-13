"use client";

import { useCreateObligation, useObligations, usePayObligation, useRefreshHome } from "@orion/core-react";
import { OBLIGATION_KIND_LABEL, type ObligationKind } from "@orion/shared-types";
import { Badge, Button, Input, Select, useToast } from "@orion/ui";
import { Receipt } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { formatMoney, parseMoneyInput, shortDate } from "../../lib/format";
import { openPanel } from "../../lib/panel-bus";
import { EmptyLine, SectionCard, type HomeSectionProps } from "./shared";

const KINDS: ObligationKind[] = ["utility", "subscription", "credit", "other"];

/** The next date a payment falls on day `day` of the month: this month if it is still ahead, else next. */
function nextDueFromDay(day: number, now = new Date()): string {
  const clamp = (year: number, month: number): Date => {
    const last = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, last), 12);
  };
  let due = clamp(now.getFullYear(), now.getMonth());
  if (due.getTime() < now.getTime() - 12 * 60 * 60 * 1000) due = clamp(now.getFullYear(), now.getMonth() + 1);
  return due.toISOString();
}

/** Utility bills and other regular payments of the home, from «Финансы → Обязательства». */
export function HomePayments({ workspaceId, home, overview }: HomeSectionProps): React.ReactElement {
  const { toast } = useToast();
  const { data: obligations } = useObligations(workspaceId);
  const create = useCreateObligation(workspaceId);
  const pay = usePayObligation(workspaceId);
  const refresh = useRefreshHome(workspaceId);

  const mine = useMemo(() => new Set(overview.obligationIds), [overview.obligationIds]);
  const rows = useMemo(
    () => (obligations ?? []).filter((o) => mine.has(o.id)).sort((a, b) => (a.nextDueAt ?? "9").localeCompare(b.nextDueAt ?? "9")),
    [obligations, mine]
  );
  const monthly = rows.filter((o) => o.interval === "monthly" && o.direction === "owe").reduce((sum, o) => sum + o.payment, 0);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const [kind, setKind] = useState<ObligationKind>("utility");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const payment = parseMoneyInput(amount);
    const dueDay = day ? Number(day) : null;
    if (!name.trim() || !payment || payment <= 0) {
      toast({ title: "Укажите название и сумму платежа", tone: "danger" });
      return;
    }
    if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
      toast({ title: "День месяца — число от 1 до 31", tone: "danger" });
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        kind,
        direction: "owe",
        payment,
        interval: "monthly",
        note: "",
        homeId: home.id,
        ...(dueDay !== null ? { nextDueAt: nextDueFromDay(dueDay) } : {})
      });
      await refresh();
      setName("");
      setAmount("");
      setDay("");
    } catch (error) {
      toast({ title: "Не удалось добавить платёж", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <SectionCard title="Платежи" icon={Receipt} summary={monthly ? `в месяц: ${formatMoney(monthly)}` : undefined}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem] flex-1">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Платёж, например «электричество»" aria-label="Название платежа" />
        </div>
        <div className="w-28 shrink-0">
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Сумма, ₽" inputMode="decimal" aria-label="Сумма" />
        </div>
        <div className="w-20 shrink-0">
          <Input value={day} onChange={(event) => setDay(event.target.value)} placeholder="День" inputMode="numeric" aria-label="День месяца" />
        </div>
        <Select aria-label="Вид платежа" value={kind} onChange={(event) => setKind(event.target.value as ObligationKind)} className="w-auto">
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {OBLIGATION_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={create.isPending}>
          Добавить
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyLine>Платежей по дому пока нет. Добавьте коммуналку, интернет, страховку — с суммой и днём месяца.</EmptyLine>
      ) : (
        <ul className="flex flex-col">
          {rows.map((o) => {
            const overdue = o.nextDueAt !== null && new Date(o.nextDueAt).getTime() < Date.now();
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/5">
                <span className="min-w-0 flex-1 truncate text-label">{o.name}</span>
                {overdue ? <Badge tone="danger">просрочено</Badge> : null}
                {o.nextDueAt ? <span className="shrink-0 font-mono text-micro tabular-nums text-subtle-foreground">{shortDate(o.nextDueAt)}</span> : null}
                <span className="shrink-0 font-mono text-label tabular-nums">{formatMoney(o.payment)}</span>
                {o.accountId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pay.isPending}
                    onClick={() =>
                      pay.mutate(
                        { obligationId: o.id, input: { accountId: o.accountId as string } },
                        { onSuccess: () => toast({ title: "Платёж записан", tone: "success" }), onError: (error) => toast({ title: "Не удалось оплатить", description: describeError(error), tone: "danger" }) }
                      )
                    }
                  >
                    Оплатить
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => openPanel("finance")} title="Укажите счёт списания в «Финансы», тогда здесь появится кнопка «Оплатить»">
                    В финансы
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
