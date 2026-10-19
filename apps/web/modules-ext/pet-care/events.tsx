"use client";

import {
  PET_EVENT_TYPES,
  PET_EVENT_TYPE_LABELS,
  addPetDays,
  type PetCareEvent,
  type PetCarePet,
  type PetEventType
} from "@orion/shared-types";
import { Button, EmptyState, IconButton, Input, Modal, Select, Skeleton, Textarea, useToast } from "@orion/ui";
import { CalendarPlus, Tag, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { formatPetDay, petLocalDayKey } from "../../lib/pet-care-days";
import { useCreatePetCareEvent, useDeletePetCareEvent, usePetCareEvents } from "./use-pet-care";

/** Добавление события (смена корма, лекарство, визит, стресс) — окно открывается из дневника и из ленты. */
export function PetEventDialog({
  open,
  onClose,
  workspaceId,
  pet,
  initialDay
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  pet: PetCarePet;
  initialDay: string;
}): React.ReactElement {
  const { toast } = useToast();
  const create = useCreatePetCareEvent(workspaceId, pet.id);
  const [day, setDay] = useState(initialDay);
  const [type, setType] = useState<PetEventType>("food_change");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await create.mutateAsync({ day, type, title: title.trim(), note: note.trim() });
      setTitle("");
      setNote("");
      onClose();
      toast({ title: "Событие добавлено", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось добавить событие", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новое событие" description="Помогает потом найти связь с самочувствием.">
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>Дата</span>
          <Input type="date" value={day} max={petLocalDayKey()} onChange={(event) => event.target.value && setDay(event.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Что произошло</span>
          <Select className="w-full" value={type} onChange={(event) => setType(event.target.value as PetEventType)}>
            {PET_EVENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {PET_EVENT_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Кратко</span>
          <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Например, «корм X»" autoFocus />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Подробности</span>
          <Textarea value={note} rows={2} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Добавить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EventRow({ event, onDelete, withDay }: { event: PetCareEvent; onDelete: () => void; withDay: boolean }): React.ReactElement {
  return (
    <li className="flex items-start gap-2 rounded-md border border-border bg-white/[0.02] px-3 py-2">
      <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{PET_EVENT_TYPE_LABELS[event.type]}</span>
        {event.title ? <span className="text-muted-foreground"> — {event.title}</span> : null}
        {withDay ? <span className="text-muted-foreground"> · {formatPetDay(event.day)}</span> : null}
        {event.note ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{event.note}</p> : null}
      </div>
      <IconButton label="Удалить событие" size="sm" tone="danger" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </li>
  );
}

/** События выбранного дня под формой дневника. */
export function PetDayEvents({ workspaceId, pet, day }: { workspaceId: string; pet: PetCarePet; day: string }): React.ReactElement {
  const { toast } = useToast();
  const events = usePetCareEvents(workspaceId, pet.id, day, day);
  const remove = useDeletePetCareEvent(workspaceId, pet.id);
  const [adding, setAdding] = useState(false);
  const list = events.data ?? [];

  return (
    <section className="rounded-lg border border-border bg-card p-3" aria-label="События дня">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">События дня{list.length > 0 ? ` · ${list.length}` : ""}</h4>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <CalendarPlus className="h-4 w-4" /> Добавить
        </Button>
      </div>
      {events.isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : list.length === 0 ? (
        <p className="text-xs text-muted-foreground">В этот день событий нет. Смена корма, лекарства, визиты, стресс — добавляйте, чтобы потом искать связь с самочувствием.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              withDay={false}
              onDelete={() => remove.mutate(event.id, { onError: (error) => toast({ title: "Не удалось удалить событие", description: describeError(error), tone: "danger" }) })}
            />
          ))}
        </ul>
      )}
      {/* key: при смене дня диалог создаётся заново и подставляет новый день по умолчанию. */}
      <PetEventDialog key={day} open={adding} onClose={() => setAdding(false)} workspaceId={workspaceId} pet={pet} initialDay={day} />
    </section>
  );
}

const PERIODS = [
  { value: "90", label: "3 месяца" },
  { value: "365", label: "Год" }
] as const;

/** Вкладка «События»: лента за период по убыванию даты. */
export function PetEventsTab({ workspaceId, pet }: { workspaceId: string; pet: PetCarePet }): React.ReactElement {
  const { toast } = useToast();
  const today = petLocalDayKey();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("90");
  const [adding, setAdding] = useState(false);
  const events = usePetCareEvents(workspaceId, pet.id, addPetDays(today, -(Number(period) - 1)), today);
  const remove = useDeletePetCareEvent(workspaceId, pet.id);
  const list = events.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} aria-label="Период" className="w-auto">
          {PERIODS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => setAdding(true)}>
          <CalendarPlus className="h-4 w-4" /> Новое событие
        </Button>
      </div>
      {events.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : events.isError ? (
        <EmptyState icon={Tag} tone="danger" title="Не удалось загрузить события" description={describeError(events.error)} />
      ) : list.length === 0 ? (
        <EmptyState icon={Tag} title="Событий нет" description="Смена корма, лекарства, прививки, визиты, стресс — записывайте, чтобы потом искать связь с самочувствием." />
      ) : (
        <ul className="space-y-1.5">
          {list.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              withDay
              onDelete={() => remove.mutate(event.id, { onError: (error) => toast({ title: "Не удалось удалить событие", description: describeError(error), tone: "danger" }) })}
            />
          ))}
        </ul>
      )}
      <PetEventDialog open={adding} onClose={() => setAdding(false)} workspaceId={workspaceId} pet={pet} initialDay={today} />
    </div>
  );
}
