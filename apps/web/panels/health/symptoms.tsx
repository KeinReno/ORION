"use client";

import { useCreateHealthSymptom, useDeleteHealthSymptom, useHealthSymptoms, useUpdateHealthSymptom } from "@orion/core-react";
import { formatDuration, healthCanWrite, symptomMinutes, symptomOngoing, type HealthSubject, type HealthSymptom } from "@orion/shared-types";
import { Button, EmptyState, Input, SegmentedControl, Skeleton, Textarea, useToast } from "@orion/ui";
import { Check, Plus, Stethoscope, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { SectionCard } from "../home/shared";

type WindowKey = "30" | "90" | "365" | "all";
const WINDOW_LABEL: Record<WindowKey, string> = { "30": "30 дней", "90": "90 дней", "365": "Год", all: "Всё" };
const when = (iso: string): string => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Сила — число и подпись, цвет лишь помогает: 0–3 слабая, 4–6 средняя, 7–10 сильная (шкала человека, не диагноз). */
function severityTone(severity: number): { label: string; className: string } {
  if (severity >= 7) return { label: "сильная", className: "text-danger" };
  if (severity >= 4) return { label: "средняя", className: "text-warning" };
  return { label: "слабая", className: "text-muted-foreground" };
}

/** Журнал самочувствия: что, насколько сильно, когда началось и закончилось. Только запись — ORION ничего не «диагностирует». */
export function HealthSymptoms({ workspaceId, subject }: { workspaceId: string | undefined; subject: HealthSubject }): React.ReactElement {
  const { toast } = useToast();
  const canWrite = healthCanWrite(subject.access);
  const [windowKey, setWindowKey] = useState<WindowKey>("90");
  const [adding, setAdding] = useState(false);
  const from = windowKey === "all" ? undefined : new Date(Date.now() - Number(windowKey) * 86_400_000).toISOString();
  const { data, isLoading, isError, refetch } = useHealthSymptoms(workspaceId, subject.id, from);
  const create = useCreateHealthSymptom(workspaceId, subject.id);
  const update = useUpdateHealthSymptom(workspaceId, subject.id);
  const remove = useDeleteHealthSymptom(workspaceId, subject.id);
  const fail = (title: string) => (error: unknown) => toast({ title, description: describeError(error), tone: "danger" });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !data) return <EmptyState icon={Stethoscope} title="Не удалось загрузить" action={<Button size="sm" onClick={() => void refetch()}>Повторить</Button>} />;

  const ongoing = data.filter(symptomOngoing);
  const past = data.filter((s) => !symptomOngoing(s));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl size="sm" aria-label="Период" value={windowKey} onChange={setWindowKey} options={(Object.keys(WINDOW_LABEL) as WindowKey[]).map((k) => ({ value: k, label: WINDOW_LABEL[k] }))} />
        {canWrite && !adding ? <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Записать</Button> : null}
      </div>

      {adding ? (
        <SectionCard title="Новая запись" icon={Stethoscope}>
          <SymptomForm busy={create.isPending} onCancel={() => setAdding(false)} onSubmit={async (values) => {
            try { await create.mutateAsync(values); setAdding(false); } catch (error) { fail("Не удалось сохранить")(error); }
          }} />
        </SectionCard>
      ) : null}

      {data.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Записей нет" description={canWrite ? "Отмечайте, что беспокоит и насколько сильно: к приёму у врача это даёт факты вместо «вроде болело»." : "За этот период ничего не записано."} />
      ) : (
        <>
          {ongoing.length > 0 ? (
            <SectionCard title="Продолжается" icon={Stethoscope} summary={`${ongoing.length}`}>
              <ul className="flex flex-col divide-y divide-border/60">
                {ongoing.map((s) => <SymptomRow key={s.id} item={s} canWrite={canWrite} onFinish={() => update.mutate({ id: s.id, input: { endedAt: new Date().toISOString() } }, { onError: fail("Не удалось сохранить") })} onDelete={() => remove.mutate(s.id, { onError: fail("Не удалось удалить") })} />)}
              </ul>
            </SectionCard>
          ) : null}
          {past.length > 0 ? (
            <SectionCard title="Прошло" icon={Check} summary={`${past.length}`}>
              <ul className="flex flex-col divide-y divide-border/60">
                {past.map((s) => <SymptomRow key={s.id} item={s} canWrite={canWrite} onDelete={() => remove.mutate(s.id, { onError: fail("Не удалось удалить") })} />)}
              </ul>
            </SectionCard>
          ) : null}
        </>
      )}
    </div>
  );
}

function SymptomRow({ item, canWrite, onFinish, onDelete }: { item: HealthSymptom; canWrite: boolean; onFinish?: () => void; onDelete: () => void }): React.ReactElement {
  const tone = severityTone(item.severity);
  return (
    <li className="py-2 text-label">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{item.name}</span>
        <span className={`text-2xs tabular-nums ${tone.className}`}>{item.severity}/10 · {tone.label}</span>
        <span className="text-2xs text-subtle-foreground">{when(item.startedAt)}{item.endedAt ? ` — ${when(item.endedAt)}` : ""} · {formatDuration(symptomMinutes(item))}</span>
        {canWrite ? (
          <span className="ml-auto flex gap-1">
            {onFinish ? <Button size="sm" variant="ghost" onClick={onFinish}><Check className="h-4 w-4" /> Прошло</Button> : null}
            <Button size="sm" variant="subtle" aria-label={`Удалить «${item.name}»`} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </span>
        ) : null}
      </div>
      {item.triggers ? <p className="mt-1 text-muted-foreground">Возможные причины: {item.triggers}</p> : null}
      {item.relief ? <p className="text-muted-foreground">Помогало: {item.relief}</p> : null}
      {item.note ? <p className="whitespace-pre-wrap text-muted-foreground">{item.note}</p> : null}
    </li>
  );
}

function SymptomForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (values: { name: string; severity: number; startedAt?: string; endedAt: string | null; triggers: string; relief: string; note: string }) => Promise<void>; onCancel: () => void }): React.ReactElement {
  const [name, setName] = useState("");
  const [severity, setSeverity] = useState(3);
  const [startedAt, setStartedAt] = useState("");
  const [triggers, setTriggers] = useState("");
  const [relief, setRelief] = useState("");
  const [note, setNote] = useState("");
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) void onSubmit({ name: name.trim(), severity, startedAt: startedAt ? new Date(startedAt).toISOString() : undefined, endedAt: null, triggers: triggers.trim(), relief: relief.trim(), note });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Что беспокоит: «головная боль», «кашель»" aria-label="Симптом" autoFocus maxLength={200} />
      <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
        Сила по вашей шкале: <span className={`text-label tabular-nums ${severityTone(severity).className}`}>{severity}/10 · {severityTone(severity).label}</span>
        <input type="range" min={0} max={10} step={1} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} aria-label="Сила, от 0 до 10" />
      </label>
      <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Когда началось (пусто — сейчас)<Input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={triggers} onChange={(e) => setTriggers(e.target.value)} placeholder="Возможные причины (необязательно)" aria-label="Возможные причины" maxLength={1000} />
        <Input value={relief} onChange={(e) => setRelief(e.target.value)} placeholder="Что помогло (необязательно)" aria-label="Что помогло" maxLength={1000} />
      </div>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка (необязательно)" aria-label="Заметка" rows={2} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="subtle" onClick={onCancel}>Отмена</Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>Сохранить</Button>
      </div>
    </form>
  );
}
