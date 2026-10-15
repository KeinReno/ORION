"use client";

import { useContactInteractions, useCreateContactInteraction, useDeleteContactInteraction, useUpdateContactCard } from "@orion/core-react";
import {
  CONTACT_INTERACTION_KINDS,
  CONTACT_INTERACTION_LABEL,
  contactFollowUp,
  type ContactCard,
  type ContactInteractionKind
} from "@orion/shared-types";
import { Button, IconButton, Input, SegmentedControl, Select, Skeleton, Textarea, useToast } from "@orion/ui";
import { CalendarClock, Mail, MessageCircle, Phone, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { describeError } from "../../lib/error-message";
import { daysUntilLabel, lastContactLabel } from "../../lib/contacts";
import { relativeTime, shortDateTime, toDatetimeLocal } from "../../lib/format";

const KIND_ICON: Record<ContactInteractionKind, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  message: MessageCircle,
  meeting: Users,
  email: Mail,
  other: CalendarClock
};

const CADENCE_OPTIONS: [string, string][] = [
  ["", "Не напоминать"],
  ["7", "Раз в неделю"],
  ["14", "Раз в 2 недели"],
  ["30", "Раз в месяц"],
  ["60", "Раз в 2 месяца"],
  ["90", "Раз в 3 месяца"],
  ["180", "Раз в полгода"],
  ["365", "Раз в год"]
];

/** The «Общение» tab: how often to reach out, when it is due, and the journal of calls/meetings. */
export function ContactJournal({ workspaceId, contact, todayKey }: { workspaceId: string; contact: ContactCard; todayKey: string }): React.ReactElement {
  const interactions = useContactInteractions(workspaceId, contact.id);
  const create = useCreateContactInteraction(workspaceId, contact.id);
  const remove = useDeleteContactInteraction(workspaceId, contact.id);
  const update = useUpdateContactCard(workspaceId);
  const { toast } = useToast();

  const [kind, setKind] = useState<ContactInteractionKind>("call");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");

  const followUp = contactFollowUp(contact, todayKey);
  const cadenceValue = contact.contactEveryDays === null ? "" : String(contact.contactEveryDays);
  const cadenceOptions = CADENCE_OPTIONS.some(([value]) => value === cadenceValue) ? CADENCE_OPTIONS : [...CADENCE_OPTIONS, [cadenceValue, `Раз в ${cadenceValue} дн.`] as [string, string]];

  async function log(): Promise<void> {
    try {
      await create.mutateAsync({ kind, note: note.trim(), ...(when ? { occurredAt: new Date(when).toISOString() } : {}) });
      setNote("");
      setWhen("");
      toast({ title: "Записано в журнал", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось записать", description: describeError(error), tone: "danger" });
    }
  }

  function setCadence(value: string): void {
    update.mutate(
      { contactId: contact.id, input: { contactEveryDays: value === "" ? null : Number(value) } },
      { onError: (error) => toast({ title: "Не удалось сохранить", description: describeError(error), tone: "danger" }) }
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-label text-foreground">Последнее общение: {lastContactLabel(contact.lastContactedAt, todayKey)}</p>
            {followUp ? (
              <p className={followUp.overdueDays >= 0 ? "text-2xs text-warning" : "text-2xs text-subtle-foreground"}>
                {followUp.overdueDays >= 0 ? "Пора связаться" : `Следующий контакт ${daysUntilLabel(-followUp.overdueDays)}`} · до {followUp.dueDate.split("-").reverse().join(".")}
              </p>
            ) : (
              <p className="text-2xs text-subtle-foreground">Напоминание о связи выключено</p>
            )}
          </div>
          <Select value={cadenceValue} onChange={(event) => setCadence(event.target.value)} aria-label="Как часто связываться" className="w-44">
            {cadenceOptions.map(([value, label]) => (
              <option key={value || "none"} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void log();
        }}
      >
        <SegmentedControl<ContactInteractionKind>
          size="sm"
          aria-label="Вид общения"
          value={kind}
          onChange={setKind}
          options={CONTACT_INTERACTION_KINDS.map((value) => ({ value, label: CONTACT_INTERACTION_LABEL[value] }))}
        />
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="О чём говорили, о чём договорились…" maxLength={2000} aria-label="Заметка об общении" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-2xs text-subtle-foreground">
            Когда
            <Input type="datetime-local" value={when} max={toDatetimeLocal(new Date().toISOString())} onChange={(event) => setWhen(event.target.value)} className="h-8 w-52 text-xs" />
            {when ? null : <span>(сейчас)</span>}
          </label>
          <Button type="submit" size="sm" disabled={create.isPending}>
            Записать
          </Button>
        </div>
      </form>

      {interactions.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (interactions.data ?? []).length === 0 ? (
        <p className="text-label text-subtle-foreground">Журнал пуст. Записывайте звонки и встречи — здесь соберётся история отношений.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {(interactions.data ?? []).map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li key={item.id} className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-label text-foreground">
                    {CONTACT_INTERACTION_LABEL[item.kind]} <span className="text-2xs text-subtle-foreground">· {shortDateTime(item.occurredAt)} · {relativeTime(item.occurredAt)}</span>
                  </p>
                  {item.note ? <p className="whitespace-pre-wrap break-words text-label text-muted-foreground">{item.note}</p> : null}
                </div>
                <IconButton label="Удалить запись" size="sm" tone="danger" className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" onClick={() => remove.mutate(item.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
