"use client";

import {
  PET_ACTIVITIES,
  PET_ACTIVITY_LABELS,
  PET_APPETITES,
  PET_APPETITE_LABELS,
  PET_DAY_STATUSES,
  PET_DAY_STATUS_META,
  PET_SEVERITIES,
  PET_SEVERITY_LABELS,
  PET_STOOLS,
  PET_STOOL_LABELS,
  PET_SYMPTOM_CATALOG,
  PET_SYMPTOM_CATEGORY_LABELS,
  PET_SYMPTOM_CATEGORY_ORDER,
  PET_TIMES_OF_DAY,
  PET_TIME_LABELS,
  PET_WATERS,
  PET_WATER_LABELS,
  computePetDayStatus,
  petSymptomLabel,
  type PetCareDayLog,
  type PetCarePet,
  type PetDaySymptom
} from "@orion/shared-types";
import { Button, ConfirmDialog, IconButton, Input, Select, Switch, Textarea, cx, useToast } from "@orion/ui";
import { ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { describeError } from "../../lib/error-message";
import { emptyPetDayDraft, formatPetDay, parseDecimalInput, petDayToDraft } from "../../lib/pet-care-days";
import { useDeletePetCareDay, useSavePetCareDay } from "./use-pet-care";

const NEW_SYMPTOM = { severity: "moderate", count: 1, time: "", note: "" } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Запись одного дня: состояние (авто или вручную), симптомы, питание и тело, лекарства, заметка.
 * Состояние формы живёт здесь; родитель меняет `key` при смене дня или после сохранения, и форма читается заново.
 */
export function PetDayForm({
  workspaceId,
  pet,
  day,
  existing,
  today,
  onStep
}: {
  workspaceId: string;
  pet: PetCarePet;
  day: string;
  existing: PetCareDayLog | undefined;
  today: string;
  onStep: (delta: number) => void;
}): React.ReactElement {
  const { toast } = useToast();
  const save = useSavePetCareDay(workspaceId, pet.id);
  const remove = useDeletePetCareDay(workspaceId, pet.id);
  const [draft, setDraft] = useState(() => (existing ? petDayToDraft(existing) : emptyPetDayDraft()));
  const [weightText, setWeightText] = useState(existing?.weightKg != null ? String(existing.weightKg) : "");
  const [temperatureText, setTemperatureText] = useState(existing?.temperature != null ? String(existing.temperature) : "");
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patch = (change: Partial<typeof draft>): void => {
    setDraft((current) => ({ ...current, ...change }));
    setDirty(true);
  };

  const autoStatus = useMemo(() => computePetDayStatus(draft), [draft]);
  const shownStatus = draft.statusAuto ? autoStatus : draft.status;
  const symptomById = useMemo(() => new Map(draft.symptoms.map((item) => [item.id, item])), [draft.symptoms]);

  const toggleSymptom = (id: string): void => {
    patch({ symptoms: symptomById.has(id) ? draft.symptoms.filter((item) => item.id !== id) : [...draft.symptoms, { id, ...NEW_SYMPTOM }] });
  };
  const patchSymptom = (id: string, change: Partial<PetDaySymptom>): void => {
    patch({ symptoms: draft.symptoms.map((item) => (item.id === id ? { ...item, ...change } : item)) });
  };

  const weight = parseDecimalInput(weightText);
  const temperature = parseDecimalInput(temperatureText);
  const weightInvalid = weightText.trim() !== "" && (weight === null || weight <= 0 || weight > 200);
  const temperatureInvalid = temperatureText.trim() !== "" && (temperature === null || temperature < 30 || temperature > 45);

  async function submit(): Promise<void> {
    try {
      await save.mutateAsync({
        day,
        // При «авто» сервер сам считает итог; ручной статус отправляем как выбран.
        input: { ...draft, status: shownStatus, weightKg: weight, temperature }
      });
      setDirty(false);
      toast({ title: "День сохранён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить день", description: describeError(error), tone: "danger" });
    }
  }

  async function removeDay(): Promise<void> {
    setConfirmDelete(false);
    try {
      await remove.mutateAsync(day);
      toast({ title: "Запись удалена", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось удалить запись", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label={`Запись за ${formatPetDay(day)}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <IconButton label="Предыдущий день" size="sm" onClick={() => onStep(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <h3 className="text-sm font-semibold">{formatPetDay(day)}</h3>
          <IconButton label="Следующий день" size="sm" disabled={day >= today} onClick={() => onStep(1)}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
        <span className="text-xs text-muted-foreground">{!existing ? "новая запись" : dirty ? "есть изменения" : "сохранено"}</span>
      </header>

      <div className="space-y-4 p-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Состояние</h4>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={draft.statusAuto} onChange={(value) => patch({ statusAuto: value, status: value ? draft.status : shownStatus })} label="Определять состояние автоматически" />
              авто
            </label>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {PET_DAY_STATUSES.map((status) => {
              const meta = PET_DAY_STATUS_META[status];
              const on = shownStatus === status;
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={on}
                  onClick={() => patch({ status, statusAuto: false })}
                  className={cx(
                    "flex min-w-0 flex-col items-start gap-1 rounded-md border px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
                    on ? "" : "border-border hover:bg-white/5"
                  )}
                  style={on ? { borderColor: meta.color, backgroundColor: `${meta.color}26` } : undefined}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                  <span className="max-w-full truncate font-medium" style={on ? { color: meta.color } : undefined}>
                    {meta.short}
                    {on && draft.statusAuto ? " · авто" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Симптомы{draft.symptoms.length > 0 ? ` · ${draft.symptoms.length}` : ""}
          </h4>
          <div className="space-y-2">
            {PET_SYMPTOM_CATEGORY_ORDER.map((category) => (
              <div key={category} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 w-28 shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">{PET_SYMPTOM_CATEGORY_LABELS[category]}</span>
                {PET_SYMPTOM_CATALOG.filter((item) => item.category === category).map((def) => {
                  const on = symptomById.has(def.id);
                  return (
                    <button
                      key={def.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSymptom(def.id)}
                      className={cx(
                        "rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
                        on
                          ? def.critical
                            ? "border-destructive bg-destructive text-white"
                            : "border-accent bg-accent text-white"
                          : def.critical
                            ? "border-destructive/40 text-destructive hover:border-destructive"
                            : "border-border hover:border-accent"
                      )}
                    >
                      {def.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {draft.symptoms.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {draft.symptoms.map((item) => (
                <li key={item.id} className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_7rem_6rem_4.5rem_auto]">
                  <span className="col-span-2 self-center text-sm font-medium sm:col-span-1">{petSymptomLabel(item.id)}</span>
                  <Select className="w-full" value={item.severity} onChange={(event) => patchSymptom(item.id, { severity: event.target.value as PetDaySymptom["severity"] })} aria-label={`${petSymptomLabel(item.id)}: выраженность`}>
                    {PET_SEVERITIES.map((value) => (
                      <option key={value} value={value}>
                        {PET_SEVERITY_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                  <Select className="w-full" value={item.time} onChange={(event) => patchSymptom(item.id, { time: event.target.value as PetDaySymptom["time"] })} aria-label={`${petSymptomLabel(item.id)}: время суток`}>
                    {PET_TIMES_OF_DAY.map((value) => (
                      <option key={value} value={value}>
                        {value === "" ? "Когда?" : PET_TIME_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={item.count}
                    onChange={(event) => patchSymptom(item.id, { count: Math.min(99, Math.max(1, Math.trunc(Number(event.target.value)) || 1)) })}
                    aria-label={`${petSymptomLabel(item.id)}: сколько раз`}
                  />
                  <IconButton label={`Убрать симптом «${petSymptomLabel(item.id)}»`} tone="danger" onClick={() => toggleSymptom(item.id)}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Питание и тело</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="Аппетит">
              <Select className="w-full" value={draft.appetite} onChange={(event) => patch({ appetite: event.target.value as typeof draft.appetite })}>
                {PET_APPETITES.map((value) => (
                  <option key={value} value={value}>
                    {PET_APPETITE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Стул">
              <Select className="w-full" value={draft.stool} onChange={(event) => patch({ stool: event.target.value as typeof draft.stool })}>
                {PET_STOOLS.map((value) => (
                  <option key={value} value={value}>
                    {PET_STOOL_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Активность">
              <Select className="w-full" value={draft.activity} onChange={(event) => patch({ activity: event.target.value as typeof draft.activity })}>
                {PET_ACTIVITIES.map((value) => (
                  <option key={value} value={value}>
                    {PET_ACTIVITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Вода">
              <Select className="w-full" value={draft.water} onChange={(event) => patch({ water: event.target.value as typeof draft.water })}>
                {PET_WATERS.map((value) => (
                  <option key={value} value={value}>
                    {PET_WATER_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Рвота, раз">
              <Input type="number" min={0} max={99} value={draft.vomitingCount} onChange={(event) => patch({ vomitingCount: Math.min(99, Math.max(0, Math.trunc(Number(event.target.value)) || 0)) })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Вес, кг">
                <Input
                  inputMode="decimal"
                  value={weightText}
                  onChange={(event) => {
                    setWeightText(event.target.value);
                    setDirty(true);
                  }}
                  aria-invalid={weightInvalid}
                  placeholder="кг"
                />
              </Field>
              <Field label="Темп., °C">
                <Input
                  inputMode="decimal"
                  value={temperatureText}
                  onChange={(event) => {
                    setTemperatureText(event.target.value);
                    setDirty(true);
                  }}
                  aria-invalid={temperatureInvalid}
                  placeholder="°C"
                />
              </Field>
            </div>
          </div>
          {weightInvalid || temperatureInvalid ? (
            <p className="mt-1 text-xs text-destructive">{weightInvalid ? "Вес — число от 0,01 до 200 кг. " : ""}{temperatureInvalid ? "Температура — от 30 до 45 °C." : ""}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Лекарства и заметка</h4>
          <Input value={draft.meds} maxLength={1000} onChange={(event) => patch({ meds: event.target.value })} placeholder="Лекарства / процедуры — например, «церукал 0,3 мл утром»" aria-label="Лекарства и процедуры" />
          <Textarea value={draft.note} rows={2} maxLength={4000} onChange={(event) => patch({ note: event.target.value })} placeholder="Заметка: что происходило, что ел, поведение…" aria-label="Заметка за день" />
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <Button onClick={() => void submit()} disabled={save.isPending || weightInvalid || temperatureInvalid || (!dirty && existing !== undefined)}>
          {save.isPending ? "Сохраняю…" : existing ? "Сохранить изменения" : "Сохранить день"}
        </Button>
        {existing ? (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={remove.isPending}>
            <Trash2 className="h-4 w-4" /> Удалить
          </Button>
        ) : null}
      </footer>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить запись?"
        description={`Запись «${pet.name}» за ${formatPetDay(day)} будет удалена.`}
        onConfirm={() => void removeDay()}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}
