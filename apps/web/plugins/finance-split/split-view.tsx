"use client";

import { useSession, useSplitActions, useSplitOverview, useWorkspaceMembers } from "@orion/core-react";
import {
  equalShares,
  suggestSettlements,
  type Settlement,
  type Split,
  type SplitShare,
  type WorkspaceMember
} from "@orion/shared-types";
import { Button, Card, ConfirmDialog, EmptyState, IconButton, Input, Modal, Select, Skeleton, useToast } from "@orion/ui";
import { HandCoins, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { FinanceTabSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError, formatMoney, shortDate, toKopecks, useActiveWorkspace } from "../../lib/extensions/host-api";

const FORMER = "Бывший участник";

/**
 * Plugin `finance-split`: «Общие расходы». Who paid for something shared and who owes whom. This is a ledger between
 * people — it never changes an account balance; the balances shown are exact (computed by the server over every
 * record), and the proposed settlements are the fewest payments that clear them.
 */
export function SplitView({ workspaceId }: FinanceTabSlotProps): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const id = workspaceId ?? workspace?.id;
  const { user } = useSession();
  const { data: members } = useWorkspaceMembers(id);
  const { data, isLoading } = useSplitOverview(id);
  const actions = useSplitActions(id);
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: "split" | "settlement"; id: string; label: string } | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map((members ?? []).map((member) => [member.userId, member.name]));
    return (userId: string): string => (userId === user?.id ? "Вы" : (map.get(userId) ?? FORMER));
  }, [members, user?.id]);
  const suggestions = useMemo(() => suggestSettlements(data?.balances ?? []), [data?.balances]);

  async function settle(fromUserId: string, toUserId: string, amount: number, currency: string): Promise<void> {
    try {
      await actions.createSettlement.mutateAsync({ fromUserId, toUserId, amount, currency, occurredAt: new Date().toISOString(), note: "" });
      toast({ title: "Расчёт записан", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось записать расчёт", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function confirmDelete(): Promise<void> {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    try {
      if (target.kind === "split") await actions.deleteSplit.mutateAsync(target.id);
      else await actions.deleteSettlement.mutateAsync(target.id);
    } catch (error) {
      toast({ title: "Не удалось удалить", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (isLoading || !members) return <Skeleton className="h-40" />;
  const overview = data ?? { splits: [], settlements: [], balances: [] };
  const empty = overview.splits.length === 0 && overview.settlements.length === 0;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Кто за что заплатил и кто кому должен. Остатки на счетах это не меняет.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setSettling(true)} disabled={members.length < 2}>
            <HandCoins className="h-4 w-4" /> Расчёт
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Общий расход
          </Button>
        </div>
      </div>

      {members.length < 2 ? (
        <p className="text-xs text-warning">В пространстве один участник — делить расходы не с кем. Пригласите остальных в Настройках пространства.</p>
      ) : null}

      {empty ? (
        <EmptyState icon={Users} title="Общих расходов пока нет" description="Запишите, кто заплатил за общее, — и здесь появится, кто кому сколько должен." />
      ) : (
        <>
          <Card className="space-y-3">
            <p className="text-sm font-medium text-foreground">Кто кому должен</p>
            {overview.balances.length === 0 ? (
              <p className="text-xs text-muted-foreground">Все в расчёте.</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {overview.balances.map((balance) => (
                    <li key={`${balance.currency}-${balance.userId}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{nameOf(balance.userId)}</span>
                      <span className={`font-mono tabular-nums ${balance.net > 0 ? "text-success" : "text-destructive"}`}>
                        {balance.net > 0 ? "ему должны " : "должен "}
                        {formatMoney(Math.abs(balance.net), balance.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1.5 border-t border-border pt-2">
                  <p className="text-2xs text-subtle-foreground">Чтобы закрыть всё, достаточно {suggestions.length === 1 ? "одного платежа" : `${suggestions.length} платежей`}:</p>
                  {suggestions.map((item) => (
                    <div key={`${item.fromUserId}-${item.toUserId}-${item.currency}`} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 text-foreground">
                        {nameOf(item.fromUserId)} → {nameOf(item.toUserId)} · <span className="font-mono tabular-nums">{formatMoney(item.amount, item.currency)}</span>
                      </span>
                      <Button size="sm" variant="outline" disabled={actions.createSettlement.isPending} onClick={() => void settle(item.fromUserId, item.toUserId, item.amount, item.currency)}>
                        Рассчитались
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {overview.splits.length > 0 ? (
            <section className="space-y-1.5" aria-label="Общие расходы">
              <p className="text-xs font-medium text-muted-foreground">Расходы</p>
              <ul className="space-y-1.5">
                {overview.splits.map((split) => (
                  <SplitRow key={split.id} split={split} nameOf={nameOf} canDelete={split.createdById === user?.id || split.paidById === user?.id} onDelete={() => setDeleting({ kind: "split", id: split.id, label: split.title })} />
                ))}
              </ul>
            </section>
          ) : null}

          {overview.settlements.length > 0 ? (
            <section className="space-y-1.5" aria-label="Расчёты">
              <p className="text-xs font-medium text-muted-foreground">Расчёты</p>
              <ul className="space-y-1.5">
                {overview.settlements.map((settlement) => (
                  <SettlementRow key={settlement.id} settlement={settlement} nameOf={nameOf} canDelete={[settlement.createdById, settlement.fromUserId, settlement.toUserId].includes(user?.id ?? "")} onDelete={() => setDeleting({ kind: "settlement", id: settlement.id, label: "расчёт" })} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {adding ? <SplitForm members={members} meId={user?.id} onClose={() => setAdding(false)} workspaceId={id} /> : null}
      {settling ? <SettlementForm members={members} meId={user?.id} suggestions={suggestions} onClose={() => setSettling(false)} workspaceId={id} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.kind === "split" ? "Удалить общий расход?" : "Удалить расчёт?"}
        description={deleting ? `«${deleting.label}» — балансы пересчитаются. Действие необратимо.` : undefined}
        confirmLabel="Удалить"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function SplitRow({ split, nameOf, canDelete, onDelete }: { split: Split; nameOf: (id: string) => string; canDelete: boolean; onDelete: () => void }): React.ReactElement {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{split.title}</p>
        <p className="text-2xs text-subtle-foreground">
          {shortDate(split.occurredAt)} · заплатил(а) {nameOf(split.paidById)} · делим на {split.shares.length}
        </p>
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">{formatMoney(split.amount, split.currency)}</span>
      {canDelete ? (
        <IconButton label={`Удалить расход «${split.title}»`} size="sm" tone="danger" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      ) : null}
    </li>
  );
}

function SettlementRow({ settlement, nameOf, canDelete, onDelete }: { settlement: Settlement; nameOf: (id: string) => string; canDelete: boolean; onDelete: () => void }): React.ReactElement {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          {nameOf(settlement.fromUserId)} → {nameOf(settlement.toUserId)}
        </p>
        <p className="text-2xs text-subtle-foreground">{shortDate(settlement.occurredAt)}{settlement.note ? ` · ${settlement.note}` : ""}</p>
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">{formatMoney(settlement.amount, settlement.currency)}</span>
      {canDelete ? (
        <IconButton label="Удалить расчёт" size="sm" tone="danger" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      ) : null}
    </li>
  );
}

function SplitForm({ members, meId, workspaceId, onClose }: { members: WorkspaceMember[]; meId: string | undefined; workspaceId: string | undefined; onClose: () => void }): React.ReactElement {
  const { createSplit } = useSplitActions(workspaceId);
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState(members.find((member) => member.userId === meId)?.userId ?? members[0]?.userId ?? "");
  const [included, setIncluded] = useState<string[]>(members.map((member) => member.userId));
  const [manual, setManual] = useState(false);
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const total = toKopecks(amount);

  const shares: SplitShare[] | null = useMemo(() => {
    if (!total) return null;
    if (!manual) return equalShares(total, included);
    return included.map((userId) => ({ userId, share: toKopecks(manualAmounts[userId] ?? "") ?? 0 }));
  }, [total, manual, included, manualAmounts]);
  const sharesSum = shares?.reduce((sum, share) => sum + share.share, 0) ?? 0;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return setError("Укажите, за что заплатили");
    if (!total || !shares) return setError("Введите сумму больше нуля");
    if (included.length === 0) return setError("Выберите, между кем делим");
    if (sharesSum !== total) return setError(`Доли дают ${formatMoney(sharesSum)}, а расход — ${formatMoney(total)}`);
    try {
      await createSplit.mutateAsync({ title: title.trim(), amount: total, currency: "RUB", paidById, occurredAt: new Date().toISOString(), note: "", shares });
      toast({ title: "Общий расход записан", tone: "success" });
      onClose();
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  return (
    <Modal open onClose={onClose} title="Общий расход" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} placeholder="За что, например «Продукты»" maxLength={120} autoFocus />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Сумма, ₽
            <Input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} placeholder="3000" />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Кто заплатил
            <Select value={paidById} onChange={(e) => setPaidById(e.target.value)}>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.userId === meId ? `${member.name} (вы)` : member.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="flex w-full items-center justify-between text-2xs text-subtle-foreground">
            <span>Между кем делим</span>
            <button type="button" onClick={() => setManual((value) => !value)} className="text-accent-text hover:text-accent-hover">
              {manual ? "Поровну" : "Вручную"}
            </button>
          </legend>
          {members.map((member) => {
            const on = included.includes(member.userId);
            const share = shares?.find((item) => item.userId === member.userId)?.share;
            return (
              <div key={member.userId} className="flex items-center gap-2 text-xs">
                <label className="flex flex-1 items-center gap-2 text-foreground">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setIncluded((current) => (e.target.checked ? [...current, member.userId] : current.filter((userId) => userId !== member.userId)))}
                  />
                  {member.userId === meId ? `${member.name} (вы)` : member.name}
                </label>
                {on && manual ? (
                  <Input inputMode="decimal" className="h-8 w-28 text-xs" value={manualAmounts[member.userId] ?? ""} onChange={(e) => setManualAmounts((current) => ({ ...current, [member.userId]: e.target.value }))} aria-label={`Доля: ${member.name}`} />
                ) : on && share !== undefined ? (
                  <span className="font-mono tabular-nums text-muted-foreground">{formatMoney(share)}</span>
                ) : null}
              </div>
            );
          })}
        </fieldset>
        {error ? <p className="text-2xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={createSplit.isPending}>
            Записать
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SettlementForm({
  members,
  meId,
  suggestions,
  workspaceId,
  onClose
}: {
  members: WorkspaceMember[];
  meId: string | undefined;
  suggestions: { fromUserId: string; toUserId: string; amount: number }[];
  workspaceId: string | undefined;
  onClose: () => void;
}): React.ReactElement {
  const { createSettlement } = useSplitActions(workspaceId);
  const { toast } = useToast();
  const first = suggestions[0];
  const [fromUserId, setFromUserId] = useState(first?.fromUserId ?? members.find((m) => m.userId === meId)?.userId ?? members[0]?.userId ?? "");
  const [toUserId, setToUserId] = useState(first?.toUserId ?? members.find((m) => m.userId !== fromUserId)?.userId ?? "");
  const [amount, setAmount] = useState(first ? String(first.amount / 100).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const kopecks = toKopecks(amount);
    if (!kopecks) return setError("Введите сумму больше нуля");
    if (!toUserId || toUserId === fromUserId) return setError("Выберите двух разных людей");
    try {
      await createSettlement.mutateAsync({ fromUserId, toUserId, amount: kopecks, currency: "RUB", occurredAt: new Date().toISOString(), note: "" });
      toast({ title: "Расчёт записан", tone: "success" });
      onClose();
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  const options = members.map((member) => (
    <option key={member.userId} value={member.userId}>
      {member.userId === meId ? `${member.name} (вы)` : member.name}
    </option>
  ));
  return (
    <Modal open onClose={onClose} title="Расчёт между участниками" description="Один отдал другому деньги — долг уменьшится." size="sm">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Кто отдал
            <Select value={fromUserId} onChange={(e) => setFromUserId(e.target.value)}>{options}</Select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Кому
            <Select value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
              <option value="">Выберите…</option>
              {options}
            </Select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Сумма, ₽
          <Input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} autoFocus />
        </label>
        {error ? <p className="text-2xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={createSettlement.isPending}>
            Записать
          </Button>
        </div>
      </form>
    </Modal>
  );
}
