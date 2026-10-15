"use client";

import { useContactCards, useCreateHealthAppointment, useDeleteHealthAppointment, useHealthAppointments, useUpdateHealthAppointment } from "@orion/core-react";
import { healthCanWrite, type HealthAppointment, type HealthSubject } from "@orion/shared-types";
import { Button, EmptyState, Input, Select, Skeleton, Textarea, useToast } from "@orion/ui";
import { CalendarClock, Check, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { SectionCard } from "../home/shared";

const when = (iso: string): string => new Date(iso).toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Визиты к врачам: запланированные сверху, прошедшие с итогом ниже. Врач — обычный контакт. */
export function HealthAppointments({ workspaceId, subject, contactsEnabled }: { workspaceId: string | undefined; subject: HealthSubject; contactsEnabled: boolean }): React.ReactElement {
  const { toast } = useToast();
  const canWrite = healthCanWrite(subject.access);
  const { data, isLoading, isError, refetch } = useHealthAppointments(workspaceId, subject.id);
  const { data: contacts } = useContactCards(contactsEnabled ? workspaceId : undefined);
  const create = useCreateHealthAppointment(workspaceId, subject.id);
  const update = useUpdateHealthAppointment(workspaceId, subject.id);
  const remove = useDeleteHealthAppointment(workspaceId, subject.id);
  const [adding, setAdding] = useState(false);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError || !data) return <EmptyState icon={CalendarClock} title="Не удалось загрузить визиты" action={<Button size="sm" onClick={() => void refetch()}>Повторить</Button>} />;

  const planned = data.filter((a) => !a.doneAt).sort((a, b) => a.at.localeCompare(b.at));
  const past = data.filter((a) => a.doneAt);
  const doctorName = (id: string | null): string | null => (id ? (contacts ?? []).find((c) => c.id === id)?.name ?? null : null);
  const fail = (title: string) => (error: unknown) => toast({ title, description: describeError(error), tone: "danger" });

  async function add(values: { title: string; at: string; clinic: string; purpose: string; questions: string; doctorContactId: string | null }): Promise<void> {
    try {
      await create.mutateAsync({ ...values, at: new Date(values.at).toISOString() });
      setAdding(false);
    } catch (error) {
      fail("Не удалось добавить визит")(error);
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Запланировано"
        icon={CalendarClock}
        summary={canWrite ? undefined : "только просмотр"}
      >
        {canWrite ? (
          adding ? (
            <AppointmentForm contacts={contacts ?? []} busy={create.isPending} onSubmit={add} onCancel={() => setAdding(false)} />
          ) : (
            <div><Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Новый визит</Button></div>
          )
        ) : null}
        {planned.length === 0 ? <p className="text-label text-muted-foreground">Запланированных визитов нет.</p> : (
          <ul className="flex flex-col divide-y divide-border/60">
            {planned.map((a) => (
              <PlannedRow key={a.id} item={a} doctor={doctorName(a.doctorContactId)} canWrite={canWrite}
                onDone={(outcome) => update.mutate({ id: a.id, input: { doneAt: new Date().toISOString(), outcome } }, { onError: fail("Не удалось отметить") })}
                onDelete={() => remove.mutate(a.id, { onError: fail("Не удалось удалить") })} />
            ))}
          </ul>
        )}
      </SectionCard>
      {past.length > 0 ? (
        <SectionCard title="Были" icon={Check} summary={`${past.length}`}>
          <ul className="flex flex-col divide-y divide-border/60">
            {past.map((a) => (
              <li key={a.id} className="py-2 text-label">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{a.title}</span>
                  <span className="text-2xs text-subtle-foreground">{when(a.at)}</span>
                  {doctorName(a.doctorContactId) ? <span className="text-2xs text-muted-foreground">· {doctorName(a.doctorContactId)}</span> : null}
                  {canWrite ? <button type="button" className="ml-auto text-2xs text-muted-foreground hover:text-danger" onClick={() => remove.mutate(a.id, { onError: fail("Не удалось удалить") })}>Удалить</button> : null}
                </div>
                {a.outcome ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.outcome}</p> : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}

function PlannedRow({ item, doctor, canWrite, onDone, onDelete }: { item: HealthAppointment; doctor: string | null; canWrite: boolean; onDone: (outcome: string) => void; onDelete: () => void }): React.ReactElement {
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState("");
  return (
    <li className="py-2 text-label">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{item.title}</span>
        <span className="text-2xs text-subtle-foreground">{when(item.at)}</span>
        {doctor ? <span className="text-2xs text-muted-foreground">· {doctor}</span> : null}
        {item.clinic ? <span className="text-2xs text-muted-foreground">· {item.clinic}</span> : null}
        {canWrite ? (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setClosing((v) => !v)}><Check className="h-4 w-4" /> Был</Button>
            <Button size="sm" variant="subtle" aria-label="Удалить визит" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </span>
        ) : null}
      </div>
      {item.purpose ? <p className="mt-1 text-muted-foreground">Цель: {item.purpose}</p> : null}
      {item.questions ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">Спросить: {item.questions}</p> : null}
      {closing ? (
        <form className="mt-2 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); onDone(outcome); }}>
          <Textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="Итог: что сказал врач, что назначил (необязательно)" aria-label="Итог визита" rows={3} />
          <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="subtle" onClick={() => setClosing(false)}>Отмена</Button><Button type="submit" size="sm">Сохранить</Button></div>
        </form>
      ) : null}
    </li>
  );
}

function AppointmentForm({ contacts, busy, onSubmit, onCancel }: {
  contacts: Array<{ id: string; name: string; role: string }>;
  busy: boolean;
  onSubmit: (values: { title: string; at: string; clinic: string; purpose: string; questions: string; doctorContactId: string | null }) => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const [clinic, setClinic] = useState("");
  const [purpose, setPurpose] = useState("");
  const [questions, setQuestions] = useState("");
  const [doctor, setDoctor] = useState("");
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (title.trim() && at) void onSubmit({ title: title.trim(), at, clinic: clinic.trim(), purpose, questions, doctorContactId: doctor || null });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="К кому или зачем: «Терапевт», «Анализы»" aria-label="Визит" autoFocus maxLength={200} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} aria-label="Когда" />
        <Input value={clinic} onChange={(event) => setClinic(event.target.value)} placeholder="Клиника (необязательно)" aria-label="Клиника" maxLength={200} />
      </div>
      {contacts.length > 0 ? (
        <Select aria-label="Врач" value={doctor} onChange={(event) => setDoctor(event.target.value)}>
          <option value="">Врач не выбран</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.role ? ` — ${c.role}` : ""}</option>)}
        </Select>
      ) : null}
      <Input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Цель визита (необязательно)" aria-label="Цель" maxLength={2000} />
      <Textarea value={questions} onChange={(event) => setQuestions(event.target.value)} placeholder="Вопросы врачу — чтобы не забыть на приёме" aria-label="Вопросы врачу" rows={2} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="subtle" onClick={onCancel}>Отмена</Button>
        <Button type="submit" size="sm" disabled={busy || !title.trim() || !at}>Добавить</Button>
      </div>
    </form>
  );
}
