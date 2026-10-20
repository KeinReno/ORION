"use client";

import { PET_SPECIES, PET_SPECIES_LABELS, type PetCarePet, type PetCareSpecies } from "@orion/shared-types";
import { Button, Input, Select, Textarea } from "@orion/ui";
import { useState, type FormEvent } from "react";

export interface PetFormValues {
  name: string;
  species: PetCareSpecies;
  birthday: string;
  breed: string;
  vetContact: string;
  chronic: string;
  allergies: string;
  /** Обычный вес, кг — строкой из поля; пусто — не указан. */
  weight: string;
  notes: string;
}

export function petToFormValues(pet?: PetCarePet): PetFormValues {
  return {
    name: pet?.name ?? "",
    species: pet?.species ?? "cat",
    birthday: pet?.birthday ?? "",
    breed: pet?.breed ?? "",
    vetContact: pet?.vetContact ?? "",
    chronic: pet?.chronic ?? "",
    allergies: pet?.allergies ?? "",
    weight: pet?.weightKg != null ? String(pet.weightKg).replace(".", ",") : "",
    notes: pet?.notes ?? ""
  };
}

/** Карточка питомца: имя, вид, день рождения и профиль для ветеринара. Используется и для создания, и для правки. */
export function PetForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial: PetFormValues;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: PetFormValues) => void | Promise<void>;
  onCancel?: () => void;
}): React.ReactElement {
  const [values, setValues] = useState(initial);
  const set = <K extends keyof PetFormValues>(key: K, value: PetFormValues[K]): void => setValues((current) => ({ ...current, [key]: value }));

  function handle(event: FormEvent): void {
    event.preventDefault();
    if (values.name.trim() === "") return;
    void onSubmit({ ...values, name: values.name.trim() });
  }

  return (
    <form onSubmit={handle} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span>Имя</span>
          <Input value={values.name} onChange={(event) => set("name", event.target.value)} placeholder="Например, Мурчик" maxLength={120} autoFocus required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Вид</span>
          <Select className="w-full" value={values.species} onChange={(event) => set("species", event.target.value as PetCareSpecies)}>
            {PET_SPECIES.map((item) => (
              <option key={item} value={item}>
                {PET_SPECIES_LABELS[item]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>День рождения</span>
          <Input type="date" value={values.birthday} onChange={(event) => set("birthday", event.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Порода</span>
          <Input value={values.breed} onChange={(event) => set("breed", event.target.value)} maxLength={120} />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span>Обычный вес, кг</span>
        <Input value={values.weight} onChange={(event) => set("weight", event.target.value)} inputMode="decimal" placeholder="Например, 4,2" className="max-w-[10rem]" />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Ветеринар / клиника</span>
        <Input value={values.vetContact} onChange={(event) => set("vetContact", event.target.value)} maxLength={500} placeholder="Имя, телефон, адрес" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span>Хронические болезни</span>
          <Textarea value={values.chronic} onChange={(event) => set("chronic", event.target.value)} rows={2} maxLength={1000} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Аллергии</span>
          <Textarea value={values.allergies} onChange={(event) => set("allergies", event.target.value)} rows={2} maxLength={1000} />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span>Заметки</span>
        <Textarea value={values.notes} onChange={(event) => set("notes", event.target.value)} rows={3} maxLength={4000} />
      </label>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
        ) : null}
        <Button type="submit" disabled={busy || values.name.trim() === ""}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
