"use client";

import { useCreateHealthMedication, useHealthMedications, useHealthSchedule, useMarkHealthIntake, useUpdateHealthMedication } from "@orion/core-react";
import { doseTiming, habitLocalDayKey, healthCanWrite, type HealthDose, type HealthMedication, type HealthSubject } from "@orion/shared-types";
import { Button, CalendarPicker, EmptyState, Input, Skeleton, Textarea, useToast } from "@orion/ui";
import { Archive, Check, Pencil, Pill, Plus, SkipForward, Undo2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { SectionCard } from "../home/shared";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const nowTime = (): string => `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
const dayLabel = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

/** Кнопки отметки одного слота; используются здесь и в «Сегодня». */
export function DoseActions({ dose, subjectId, workspaceId, canWrite }: { dose: HealthDose; subjectId: string; workspaceId: string | undefined; canWrite: boolean }): React.ReactElement | null {
  const { toast } = useToast();
  const mark = useMarkHealthIntake(workspaceId);
  if (!canWrite) return null;
  const set = (status: "taken" | "skipped" | null) =>
    mark.mutate({ subjectId, medicationId: dose.medicationId, day: dose.day, time: dose.time, status }, { onError: (error) => toast({ title: "Не удалось отметить", description: describeError(error), tone: "danger" }) });
  return dose.status === null ? (
    <span className="flex gap-1">
      <Button size="sm" onClick={() => set("taken")} disabled={mark.isPending}><Check className="h-4 w-4" /> Принял</Button>
      <Button size="sm" variant="subtle" onClick={() => set("skipped")} disabled={mark.isPending}><SkipForward className="h-4 w-4" /> Пропустить</Button>
    </span>
  ) : (
    <Button size="sm" variant="subtle" onClick={() => set(null)} disabled={mark.isPending}><Undo2 className="h-4 w-4" /> Отменить</Button>
  );
}

/** Лекарства человека: расписание на сегодня, список с остатком и соблюдением схемы. Доза и график — ровно то, что ввёл человек. */
export function HealthMedications({ workspaceId, subject }: { workspaceId: string | undefined; subject: HealthSubject }): React.ReactElement {
  const { toast } = useToast();
  const canWrite = healthCanWrite(subject.access);
  const today = habitLocalDayKey();
  const { data: schedule } = useHealthSchedule(workspaceId, subject.id, today);
  const { data: meds, isLoading, isError, refetch } = useHealthMedications(workspaceId, subject.id, today);
  const create = useCreateHealthMedication(workspaceId, subject.id);
  const update = useUpdateHealthMedication(workspaceId, subject.id);
  const mark = useMarkHealthIntake(workspaceId);
  const [editing, setEditing] = useState<HealthMedication | "new" | null>(null);
  const fail = (title: string) => (error: unknown) => toast({ title, description: describeError(error), tone: "danger" });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !meds) return <EmptyState icon={Pill} title="Не удалось загрузить лекарства" action={<Button size="sm" onClick={() => void refetch()}>Повторить</Button>} />;

  const asNeeded = meds.filter((m) => m.asNeeded);
  const time = nowTime();

  return (
    <div className="space-y-4">
      <SectionCard title="Сегодня" icon={Pill} summary={schedule ? `${schedule.filter((d) => d.status === "taken").length} из ${schedule.length} принято` : undefined}>
        {!schedule || schedule.length === 0 ? (
          <p className="text-label text-muted-foreground">На сегодня приёмов по расписанию нет.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {schedule.map((dose) => {
              const late = dose.status === null && doseTiming(dose, today, time) === "past";
              return (
                <li key={`${dose.medicationId}|${dose.time}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-label">
                  <span className="w-12 shrink-0 font-mono tabular-nums">{dose.time}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{dose.name}</span>
                    <span className="text-muted-foreground">{dose.dose ? ` · ${dose.dose}` : ""}{dose.form ? ` · ${dose.form}` : ""}</span>
                  </span>
                  <span className={`text-2xs ${dose.status === "taken" ? "text-success" : late ? "text-warning" : "text-subtle-foreground"}`}>
                    {dose.status === "taken" ? "Принято" : dose.status === "skipped" ? "Пропущено" : late ? "Время прошло" : "Впереди"}
                  </span>
                  <DoseActions dose={dose} subjectId={subject.id} workspaceId={workspaceId} canWrite={canWrite} />
                </li>
              );
            })}
          </ul>
        )}
        {canWrite && asNeeded.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <span className="text-2xs text-muted-foreground">По требованию:</span>
            {asNeeded.map((m) => (
              <Button key={m.id} size="sm" variant="ghost" onClick={() => mark.mutate({ subjectId: subject.id, medicationId: m.id, day: today, time: nowTime(), status: "taken" }, { onError: fail("Не удалось отметить") })}>
                {m.name} — принял сейчас
              </Button>
            ))}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Лекарства" icon={Pill} summary={canWrite ? undefined : "только просмотр"}>
        {canWrite ? (
          editing ? (
            <MedicationForm
              key={editing === "new" ? "new" : editing.id}
              initial={editing === "new" ? null : editing}
              busy={create.isPending || update.isPending}
              onCancel={() => setEditing(null)}
              onSubmit={async (values) => {
                try {
                  if (editing === "new") await create.mutateAsync(values);
                  else await update.mutateAsync({ id: editing.id, input: values });
                  setEditing(null);
                } catch (error) {
                  fail("Не удалось сохранить")(error);
                }
              }}
            />
          ) : (
            <div><Button size="sm" variant="ghost" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Добавить лекарство</Button></div>
          )
        ) : null}
        {meds.length === 0 ? (
          <p className="text-label text-muted-foreground">Пока ничего нет. Введите лекарство, дозу и время — ORION будет показывать приёмы в «Сегодня». Дозу и схему назначает врач; ORION их не подсказывает.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {meds.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-label">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground">{m.dose ? ` · ${m.dose}` : ""}{m.form ? ` · ${m.form}` : ""}</span>
                  <span className="block text-2xs text-subtle-foreground">
                    {m.asNeeded ? "По требованию" : `${m.times.join(", ")}${m.weekdays.length ? ` · ${m.weekdays.map((d) => WEEKDAYS[d]).join(", ")}` : " · каждый день"}`}
                    {m.startOn || m.endOn ? ` · курс ${m.startOn ? `с ${dayLabel(m.startOn)}` : ""}${m.endOn ? ` по ${dayLabel(m.endOn)}` : ""}` : ""}
                  </span>
                  {m.adherence.planned > 0 ? <span className="block text-2xs text-muted-foreground">За 30 дней принято {m.adherence.taken} из {m.adherence.planned}{m.adherence.skipped ? `, пропущено осознанно ${m.adherence.skipped}` : ""}</span> : null}
                </span>
                {m.stock !== null ? <span className={`text-2xs ${m.lowStock ? "text-warning" : "text-muted-foreground"}`}>{m.lowStock ? "Заканчивается: " : "Осталось: "}{m.stock}</span> : null}
                {canWrite ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="subtle" aria-label={`Изменить «${m.name}»`} onClick={() => setEditing(m)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="subtle" aria-label={`В архив «${m.name}»`} onClick={() => update.mutate({ id: m.id, input: { archivedAt: new Date().toISOString() } }, { onError: fail("Не удалось архивировать") })}><Archive className="h-4 w-4" /></Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function MedicationForm({ initial, busy, onSubmit, onCancel }: {
  initial: HealthMedication | null;
  busy: boolean;
  onSubmit: (values: { name: string; form: string; dose: string; times: string[]; weekdays: number[]; startOn: string | null; endOn: string | null; asNeeded: boolean; stock: number | null; lowStockAt: number | null; note: string }) => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [form, setForm] = useState(initial?.form ?? "");
  const [dose, setDose] = useState(initial?.dose ?? "");
  const [times, setTimes] = useState(initial?.times.join(", ") ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
  const [startOn, setStartOn] = useState(initial?.startOn ?? "");
  const [endOn, setEndOn] = useState(initial?.endOn ?? "");
  const [asNeeded, setAsNeeded] = useState(initial?.asNeeded ?? false);
  const [stock, setStock] = useState(initial?.stock?.toString() ?? "");
  const [lowStockAt, setLowStockAt] = useState(initial?.lowStockAt?.toString() ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const parsedTimes = times.split(/[\s,;]+/).filter(Boolean);
  const timesValid = asNeeded || (parsedTimes.length > 0 && parsedTimes.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)));

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!name.trim() || !timesValid) return;
    void onSubmit({
      name: name.trim(), form: form.trim(), dose: dose.trim(), times: asNeeded ? [] : parsedTimes, weekdays, asNeeded, note,
      startOn: startOn || null, endOn: endOn || null,
      stock: stock === "" ? null : Number(stock), lowStockAt: lowStockAt === "" ? null : Number(lowStockAt)
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название лекарства" aria-label="Название" autoFocus maxLength={200} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="Доза — как назначил врач, например «1 таблетка»" aria-label="Доза" maxLength={120} />
        <Input value={form} onChange={(e) => setForm(e.target.value)} placeholder="Форма (необязательно): таблетки, капли" aria-label="Форма" maxLength={60} />
      </div>
      <label className="flex items-center gap-2 text-label"><input type="checkbox" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} /> Принимается по требованию (без расписания)</label>
      {!asNeeded ? (
        <>
          <Input value={times} onChange={(e) => setTimes(e.target.value)} placeholder="Время приёма через запятую: 08:00, 20:00" aria-label="Время приёма" aria-invalid={!timesValid} />
          {!timesValid && times ? <p className="text-2xs text-danger">Время в формате ЧЧ:ММ, например 08:00</p> : null}
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Дни недели">
            <span className="mr-1 text-2xs text-muted-foreground">Дни (ничего — каждый день):</span>
            {WEEKDAYS.map((label, index) => (
              <button key={label} type="button" aria-pressed={weekdays.includes(index)} onClick={() => setWeekdays((cur) => (cur.includes(index) ? cur.filter((d) => d !== index) : [...cur, index].sort()))}
                className={`rounded-md border px-2 py-0.5 text-2xs ${weekdays.includes(index) ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted-foreground"}`}>{label}</button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
              Курс с
              <CalendarPicker value={startOn} onChange={setStartOn} />
              {startOn ? <button type="button" className="self-start text-micro text-ui-subtle" onClick={() => setStartOn("")}>Очистить</button> : null}
            </label>
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
              Курс по
              <CalendarPicker value={endOn} onChange={setEndOn} />
              {endOn ? <button type="button" className="self-start text-micro text-ui-subtle" onClick={() => setEndOn("")}>Очистить</button> : null}
            </label>
          </div>
        </>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Остаток, штук (необязательно)" aria-label="Остаток" />
        <Input type="number" min={0} value={lowStockAt} onChange={(e) => setLowStockAt(e.target.value)} placeholder="Предупредить, когда останется" aria-label="Порог остатка" />
      </div>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка (необязательно): до/после еды, от чего" aria-label="Заметка" rows={2} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="subtle" onClick={onCancel}>Отмена</Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim() || !timesValid}>{initial ? "Сохранить" : "Добавить"}</Button>
      </div>
    </form>
  );
}
