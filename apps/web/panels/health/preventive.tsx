"use client";

import { useCreateHealthPreventive, useDeleteHealthPreventive, useHealthPreventive, useMarkHealthPreventiveDone } from "@orion/core-react";
import {
  HEALTH_PREVENTIVE_KINDS,
  HEALTH_PREVENTIVE_KIND_LABEL,
  habitLocalDayKey,
  healthCanWrite,
  preventiveStatus,
  type HealthPreventiveKind,
  type HealthSubject
} from "@orion/shared-types";
import { Button, EmptyState, Input, Select, Skeleton, useToast } from "@orion/ui";
import { Check, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { SectionCard } from "../home/shared";

const dayLabel = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const STATUS_LABEL = { overdue: "Просрочено", soon: "Скоро", ok: "В порядке", unscheduled: "Без срока" } as const;
const STATUS_CLASS = { overdue: "text-danger", soon: "text-warning", ok: "text-muted-foreground", unscheduled: "text-subtle-foreground" } as const;

/** Осмотры, прививки и анализы с периодичностью. Следующий срок вычисляется, «Сделано» двигает его. */
export function HealthPreventive({ workspaceId, subject }: { workspaceId: string | undefined; subject: HealthSubject }): React.ReactElement {
  const { toast } = useToast();
  const canWrite = healthCanWrite(subject.access);
  const { data, isLoading, isError, refetch } = useHealthPreventive(workspaceId, subject.id);
  const create = useCreateHealthPreventive(workspaceId, subject.id);
  const done = useMarkHealthPreventiveDone(workspaceId, subject.id);
  const remove = useDeleteHealthPreventive(workspaceId, subject.id);
  const [adding, setAdding] = useState(false);
  const today = habitLocalDayKey();
  const fail = (title: string) => (error: unknown) => toast({ title, description: describeError(error), tone: "danger" });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError || !data) return <EmptyState icon={ShieldCheck} title="Не удалось загрузить" action={<Button size="sm" onClick={() => void refetch()}>Повторить</Button>} />;

  const rows = data.map((item) => ({ item, status: preventiveStatus(item.nextDueAt, today) })).sort((a, b) => (a.item.nextDueAt ?? "9999").localeCompare(b.item.nextDueAt ?? "9999"));

  return (
    <SectionCard title="Профилактика" icon={ShieldCheck} summary={canWrite ? undefined : "только просмотр"}>
      {canWrite ? (
        adding ? (
          <PreventiveForm busy={create.isPending} onCancel={() => setAdding(false)} onSubmit={async (values) => {
            try { await create.mutateAsync(values); setAdding(false); } catch (error) { fail("Не удалось добавить")(error); }
          }} />
        ) : (
          <div><Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Добавить</Button></div>
        )
      ) : null}
      {rows.length === 0 ? (
        <p className="text-label text-muted-foreground">Пока пусто. Добавьте, например, «Стоматолог — раз в 6 месяцев», и ORION подскажет, когда пора.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {rows.map(({ item, status }) => (
            <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-label">
              <span className={`w-24 shrink-0 text-2xs ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground"> · {HEALTH_PREVENTIVE_KIND_LABEL[item.kind]}{item.everyMonths ? ` · раз в ${item.everyMonths} мес.` : ""}</span>
                <span className="block text-2xs text-subtle-foreground">
                  {item.nextDueAt ? `Срок: ${dayLabel(item.nextDueAt)}` : "Срока нет"}
                  {item.lastDoneAt ? ` · в последний раз: ${dayLabel(item.lastDoneAt)}` : ""}
                </span>
              </span>
              {canWrite ? (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => done.mutate({ id: item.id, input: { doneOn: today } }, { onError: fail("Не удалось отметить") })}><Check className="h-4 w-4" /> Сделано</Button>
                  <Button size="sm" variant="subtle" aria-label={`Удалить «${item.name}»`} onClick={() => remove.mutate(item.id, { onError: fail("Не удалось удалить") })}><Trash2 className="h-4 w-4" /></Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PreventiveForm({ busy, onSubmit, onCancel }: {
  busy: boolean;
  onSubmit: (values: { name: string; kind: HealthPreventiveKind; everyMonths: number | null; firstDueAt: string | null; lastDoneAt: string | null; note: string }) => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<HealthPreventiveKind>("checkup");
  const [every, setEvery] = useState("");
  const [last, setLast] = useState("");
  const [first, setFirst] = useState("");
  function submit(event: FormEvent): void {
    event.preventDefault();
    const months = every ? Number(every) : null;
    if (!name.trim() || (months !== null && (!Number.isInteger(months) || months < 1))) return;
    void onSubmit({ name: name.trim(), kind, everyMonths: months, lastDoneAt: last || null, firstDueAt: first || null, note: "" });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Что: «Стоматолог», «Прививка от гриппа»" aria-label="Название" autoFocus maxLength={200} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Select aria-label="Вид" value={kind} onChange={(event) => setKind(event.target.value as HealthPreventiveKind)}>
          {HEALTH_PREVENTIVE_KINDS.map((k) => <option key={k} value={k}>{HEALTH_PREVENTIVE_KIND_LABEL[k]}</option>)}
        </Select>
        <Input type="number" min={1} max={600} value={every} onChange={(event) => setEvery(event.target.value)} placeholder="Раз в … месяцев (пусто — разово)" aria-label="Периодичность, месяцев" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Когда делали в последний раз<Input type="date" value={last} onChange={(event) => setLast(event.target.value)} /></label>
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Первый срок (если ещё не делали)<Input type="date" value={first} onChange={(event) => setFirst(event.target.value)} /></label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="subtle" onClick={onCancel}>Отмена</Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>Добавить</Button>
      </div>
    </form>
  );
}
