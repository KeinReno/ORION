"use client";

import { useDeleteHealthSubject, useFetchHealthSummary, useHealthGrants, usePutHealthGrant, useRemoveHealthGrant, useUpdateHealthSubject, useWorkspaceMembers } from "@orion/core-react";
import {
  HEALTH_GRANT_LABEL,
  type CreateHealthSubjectInput,
  type HealthAllergy,
  type HealthGrantLevel,
  type HealthSubject
} from "@orion/shared-types";
import { Button, CalendarPicker, Combobox, ConfirmDialog, GlideSelect, Input, Textarea, useToast } from "@orion/ui";
import { IdCard, Printer, Share2, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { buildHealthCardHtml, printHtml, type HealthCardKind } from "../../lib/health-card";
import { SectionCard } from "../home/shared";

const SEPARATOR = " — ";

/** «Арахис — сыпь» ↔ { substance, reaction }: одна аллергия на строку. */
export function parseAllergies(text: string): HealthAllergy[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(SEPARATOR);
      return at === -1 ? { substance: line, reaction: "" } : { substance: line.slice(0, at).trim(), reaction: line.slice(at + SEPARATOR.length).trim() };
    })
    .filter((a) => a.substance);
}
export const formatAllergies = (items: HealthAllergy[]): string => items.map((a) => (a.reaction ? `${a.substance}${SEPARATOR}${a.reaction}` : a.substance)).join("\n");
const parseLines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** Создание человека: «я» или тот, кого вы ведёте (ребёнок, родитель). */
export function SubjectForm({ kind, busy, onSubmit, onCancel }: { kind: "member" | "dependent"; busy: boolean; onSubmit: (values: CreateHealthSubjectInput) => Promise<void>; onCancel: () => void }): React.ReactElement {
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) void onSubmit({ kind, name: name.trim(), birthDate: birthDate || null, bloodType: "", allergies: [], conditions: [], emergencyNote: "" });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-label text-muted-foreground">
        {kind === "member" ? "Этот профиль увидите только вы. Другому участнику его можно открыть позже." : "Вы будете вести этого человека как опекун; другим участникам он не виден, пока вы сами не откроете доступ."}
      </p>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "member" ? "Как вас зовут" : "Имя: «Маша», «Мама»"} aria-label="Имя" autoFocus maxLength={120} />
      <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
        Дата рождения (необязательно)
        <CalendarPicker value={birthDate} onChange={setBirthDate} />
        {birthDate ? <button type="button" className="self-start text-micro text-ui-subtle" onClick={() => setBirthDate("")}>Очистить</button> : null}
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>Отмена</Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>Создать</Button>
      </div>
    </form>
  );
}

/** Карточка человека: сведения для врача и экстренного случая, доступ других, удаление. */
export function HealthProfile({ workspaceId, subject, onDeleted }: { workspaceId: string | undefined; subject: HealthSubject; onDeleted: () => void }): React.ReactElement {
  const { toast } = useToast();
  const own = subject.access === "own";
  const update = useUpdateHealthSubject(workspaceId);
  const remove = useDeleteHealthSubject(workspaceId);
  const [name, setName] = useState(subject.name);
  const [birthDate, setBirthDate] = useState(subject.birthDate ?? "");
  const [bloodType, setBloodType] = useState(subject.bloodType);
  const [allergies, setAllergies] = useState(formatAllergies(subject.allergies));
  const [conditions, setConditions] = useState(subject.conditions.join("\n"));
  const [emergency, setEmergency] = useState(subject.emergencyNote);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fetchSummary = useFetchHealthSummary(workspaceId);

  /** Сводка запрашивается в момент нажатия, чтобы в карточке были свежие данные; в печать уходит только по вашему действию. */
  async function printCard(kind: HealthCardKind): Promise<void> {
    try {
      printHtml(buildHealthCardHtml(await fetchSummary.mutateAsync(subject.id), kind));
    } catch (error) {
      toast({ title: "Не удалось подготовить карточку", description: describeError(error), tone: "danger" });
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await update.mutateAsync({
        subjectId: subject.id,
        input: { name: name.trim(), birthDate: birthDate || null, bloodType: bloodType.trim(), allergies: parseAllergies(allergies), conditions: parseLines(conditions), emergencyNote: emergency }
      });
      toast({ title: "Сохранено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Карточка" icon={IdCard} summary={own ? undefined : "только просмотр"}>
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground sm:col-span-1">Имя<Input value={name} onChange={(e) => setName(e.target.value)} disabled={!own} maxLength={120} /></label>
            <div className="flex flex-col gap-1 text-2xs text-muted-foreground">
              Дата рождения
              <CalendarPicker value={birthDate} onChange={setBirthDate} disabled={!own} />
              {own && birthDate ? <button type="button" className="self-start text-micro text-ui-subtle" onClick={() => setBirthDate("")}>Очистить</button> : null}
            </div>
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Группа крови<Input value={bloodType} onChange={(e) => setBloodType(e.target.value)} disabled={!own} placeholder="например, A(II) Rh+" maxLength={12} /></label>
          </div>
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Аллергии — по одной на строку, «вещество — реакция»<Textarea value={allergies} onChange={(e) => setAllergies(e.target.value)} disabled={!own} rows={3} placeholder="Арахис — сыпь" /></label>
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Хронические состояния — по одному на строку<Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} disabled={!own} rows={3} /></label>
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">Экстренная заметка<Textarea value={emergency} onChange={(e) => setEmergency(e.target.value)} disabled={!own} rows={2} placeholder="Кому звонить, что важно знать врачу скорой" /></label>
          {own ? (
            <div className="flex justify-between gap-2">
              <Button type="button" variant="subtle" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /> Удалить человека</Button>
              <Button type="submit" size="sm" disabled={update.isPending || !name.trim()}>Сохранить</Button>
            </div>
          ) : null}
        </form>
      </SectionCard>

      <SectionCard title="Распечатать или сохранить в PDF" icon={Printer}>
        <p className="text-label text-muted-foreground">Документ собирается из ваших записей по нажатию и никуда не отправляется. Откроется окно печати — там же можно выбрать «Сохранить как PDF».</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void printCard("doctor")} disabled={fetchSummary.isPending}>Карточка для врача</Button>
          <Button size="sm" variant="ghost" onClick={() => void printCard("emergency")} disabled={fetchSummary.isPending}>Экстренная карточка</Button>
        </div>
      </SectionCard>

      {own ? <Sharing workspaceId={workspaceId} subject={subject} /> : null}

      <ConfirmDialog
        open={confirmDelete}
        title={`Удалить «${subject.name}»?`}
        description="Вместе с человеком удалятся все его визиты, профилактика и выданные доступы. Это нельзя отменить."
        onConfirm={() => {
          setConfirmDelete(false);
          remove.mutate(subject.id, { onSuccess: onDeleted, onError: (error) => toast({ title: "Не удалось удалить", description: describeError(error), tone: "danger" }) });
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Кому, кроме вас (и опекуна), открыт этот человек: просмотр или совместное ведение. Владелец пространства прав не получает. */
function Sharing({ workspaceId, subject }: { workspaceId: string | undefined; subject: HealthSubject }): React.ReactElement {
  const { toast } = useToast();
  const { data: grants } = useHealthGrants(workspaceId, subject.id);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const put = usePutHealthGrant(workspaceId, subject.id);
  const revoke = useRemoveHealthGrant(workspaceId, subject.id);
  const [grantee, setGrantee] = useState("");
  const [level, setLevel] = useState<HealthGrantLevel>("read");
  const ownerIds = new Set([subject.userId, subject.guardianUserId].filter(Boolean));
  const granted = new Set((grants ?? []).map((g) => g.granteeUserId));
  const candidates = (members ?? []).filter((m) => !ownerIds.has(m.userId) && !granted.has(m.userId));
  const fail = (title: string) => (error: unknown) => toast({ title, description: describeError(error), tone: "danger" });

  return (
    <SectionCard title="Кто ещё видит" icon={Share2} summary={`${grants?.length ?? 0}`}>
      <p className="text-label text-muted-foreground">По умолчанию эти данные видите только вы{subject.kind === "dependent" ? " как опекун" : ""}. Даже владелец пространства их не видит, пока вы не откроете доступ.</p>
      {(grants ?? []).length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/60">
          {(grants ?? []).map((g) => (
            <li key={g.granteeUserId} className="flex flex-wrap items-center gap-2 py-1.5 text-label">
              <span className="min-w-0 flex-1 truncate">{g.granteeName}</span>
              <GlideSelect
                label={`Доступ: ${g.granteeName}`}
                options={(Object.keys(HEALTH_GRANT_LABEL) as HealthGrantLevel[]).map((level) => HEALTH_GRANT_LABEL[level])}
                value={HEALTH_GRANT_LABEL[g.level]}
                onChange={(label) => {
                  const next = (Object.keys(HEALTH_GRANT_LABEL) as HealthGrantLevel[]).find((level) => HEALTH_GRANT_LABEL[level] === label);
                  if (next) put.mutate({ granteeUserId: g.granteeUserId, input: { level: next } }, { onError: fail("Не удалось изменить") });
                }}
              />
              <Button size="sm" variant="subtle" onClick={() => revoke.mutate(g.granteeUserId, { onError: fail("Не удалось закрыть доступ") })}>Закрыть</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {candidates.length > 0 ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (grantee) put.mutate({ granteeUserId: grantee, input: { level } }, { onSuccess: () => setGrantee(""), onError: fail("Не удалось открыть доступ") }); }}>
          <div className="w-52">
            <Combobox
              label="Кому открыть"
              value={grantee}
              onChange={setGrantee}
              items={[{ id: "", label: "Выберите участника" }, ...candidates.map((member) => ({ id: member.userId, label: member.name }))]}
            />
          </div>
          <div className="w-44">
            <GlideSelect
              label="Уровень доступа"
              options={(Object.keys(HEALTH_GRANT_LABEL) as HealthGrantLevel[]).map((item) => HEALTH_GRANT_LABEL[item])}
              value={HEALTH_GRANT_LABEL[level]}
              onChange={(label) => {
                const next = (Object.keys(HEALTH_GRANT_LABEL) as HealthGrantLevel[]).find((item) => HEALTH_GRANT_LABEL[item] === label);
                if (next) setLevel(next);
              }}
            />
          </div>
          <Button type="submit" size="sm" disabled={!grantee || put.isPending}>Открыть доступ</Button>
        </form>
      ) : (members ?? []).length > 0 && (grants ?? []).length === 0 ? <p className="text-2xs text-subtle-foreground">В пространстве нет других участников, которым можно открыть доступ.</p> : null}
    </SectionCard>
  );
}
