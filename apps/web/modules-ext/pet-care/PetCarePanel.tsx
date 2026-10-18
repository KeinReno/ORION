"use client";

import {
  PET_CARE_KINDS,
  PET_CARE_KIND_LABELS,
  PET_SPECIES,
  PET_SPECIES_LABELS,
  type PetCareKind,
  type PetCarePet,
  type PetCareSpecies
} from "@orion/shared-types";
import { Button, EmptyState, Input, Modal, PanelBody, PanelHeader, PanelShell, Select, Skeleton, Textarea, useToast } from "@orion/ui";
import { PawPrint, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { formatDayTitle, shortDateTime } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import {
  useCreatePetCareEntry,
  useCreatePetCarePet,
  useDeletePetCareEntry,
  useDeletePetCarePet,
  usePetCareEntries,
  usePetCarePets
} from "./use-pet-care";

/**
 * Pet Care (образец модуля по манифесту): список питомцев с формой добавления и журналом ухода.
 * Подключается генерируемым `modules-ext/panels.generated.ts`, а не строкой в `panel-registry.ts`.
 */
export function PetCarePanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const pets = usePetCarePets(workspaceId);
  const createPet = useCreatePetCarePet(workspaceId);
  const [creating, setCreating] = useState(false);

  async function submit(values: { name: string; species: PetCareSpecies; birthday: string; notes: string }): Promise<void> {
    try {
      await createPet.mutateAsync({
        name: values.name,
        species: values.species,
        birthday: values.birthday || null,
        notes: values.notes
      });
      setCreating(false);
      toast({ title: "Питомец добавлен", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось добавить питомца", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={PawPrint}
        title="Питомцы"
        subtitle="Карточки питомцев и журнал ухода"
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={workspaceId === undefined}>
            <Plus className="h-4 w-4" /> Новый питомец
          </Button>
        }
      />
      <PanelBody measure="wide">
        {workspaceId === undefined ? (
          workspaceLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <EmptyState icon={PawPrint} title="Нет рабочего пространства" description="Питомцы живут внутри пространства — создайте его или войдите заново." />
          )
        ) : pets.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : pets.isError ? (
          <EmptyState
            icon={PawPrint}
            tone="danger"
            title="Не удалось загрузить питомцев"
            description={describeError(pets.error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void pets.refetch()}>
                Повторить
              </Button>
            }
          />
        ) : (pets.data ?? []).length === 0 ? (
          <EmptyState
            icon={PawPrint}
            title="Питомцев пока нет"
            description="Добавьте первого питомца и записывайте кормление, визиты к ветеринару, лекарства и прогулки."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Новый питомец
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3" aria-label="Питомцы">
            {(pets.data ?? []).map((pet) => (
              <PetCard key={pet.id} workspaceId={workspaceId} pet={pet} />
            ))}
          </ul>
        )}
      </PanelBody>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый питомец">
        <PetForm busy={createPet.isPending} onSubmit={submit} onCancel={() => setCreating(false)} />
      </Modal>
    </PanelShell>
  );
}

function PetForm({
  busy,
  onSubmit,
  onCancel
}: {
  busy: boolean;
  onSubmit: (values: { name: string; species: PetCareSpecies; birthday: string; notes: string }) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState<PetCareSpecies>("other");
  const [birthday, setBirthday] = useState("");
  const [notes, setNotes] = useState("");

  function handle(event: FormEvent): void {
    event.preventDefault();
    if (name.trim() === "") return;
    void onSubmit({ name: name.trim(), species, birthday, notes });
  }

  return (
    <form onSubmit={handle} className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span>Имя</span>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Барсик" maxLength={120} autoFocus required />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Вид</span>
        <Select value={species} onChange={(event) => setSpecies(event.target.value as PetCareSpecies)}>
          {PET_SPECIES.map((item) => (
            <option key={item} value={item}>
              {PET_SPECIES_LABELS[item]}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>День рождения</span>
        <Input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Заметки</span>
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={4000} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" disabled={busy || name.trim() === ""}>
          Добавить
        </Button>
      </div>
    </form>
  );
}

function PetCard({ workspaceId, pet }: { workspaceId: string; pet: PetCarePet }): React.ReactElement {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PetCareKind>("feeding");
  const [note, setNote] = useState("");
  const entries = usePetCareEntries(workspaceId, open ? pet.id : undefined);
  const createEntry = useCreatePetCareEntry(workspaceId, pet.id);
  const deleteEntry = useDeletePetCareEntry(workspaceId, pet.id);
  const deletePet = useDeletePetCarePet(workspaceId);

  async function addEntry(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await createEntry.mutateAsync({ kind, note: note.trim() });
      setNote("");
    } catch (error) {
      toast({ title: "Не удалось записать уход", description: describeError(error), tone: "danger" });
    }
  }

  async function removePet(): Promise<void> {
    if (!window.confirm(`Удалить «${pet.name}» вместе с журналом ухода?`)) return;
    try {
      await deletePet.mutateAsync(pet.id);
    } catch (error) {
      toast({ title: "Не удалось удалить питомца", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <li className="rounded-lg border border-border bg-card p-3" data-testid={`pet-care-pet-${pet.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{pet.name}</div>
          <div className="text-xs text-muted-foreground">
            {PET_SPECIES_LABELS[pet.species]}
            {pet.birthday ? ` · родился ${formatDayTitle(pet.birthday)}` : ""}
          </div>
          {pet.notes ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{pet.notes}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? "Скрыть журнал" : "Журнал ухода"}
          </Button>
          <Button size="sm" variant="subtle" onClick={() => void removePet()} aria-label={`Удалить ${pet.name}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <form onSubmit={(event) => void addEntry(event)} className="flex flex-wrap items-center gap-2">
            <Select value={kind} onChange={(event) => setKind(event.target.value as PetCareKind)} aria-label="Вид ухода">
              {PET_CARE_KINDS.map((item) => (
                <option key={item} value={item}>
                  {PET_CARE_KIND_LABELS[item]}
                </option>
              ))}
            </Select>
            <Input
              className="min-w-[10rem] flex-1"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Заметка (необязательно)"
              maxLength={2000}
              aria-label="Заметка к записи"
            />
            <Button type="submit" size="sm" disabled={createEntry.isPending}>
              Записать
            </Button>
          </form>
          {entries.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (entries.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Записей ухода пока нет.</p>
          ) : (
            <ul className="space-y-1">
              {(entries.data ?? []).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{PET_CARE_KIND_LABELS[entry.kind]}</span>
                    <span className="text-muted-foreground"> · {shortDateTime(entry.occurredAt)}</span>
                    {entry.note ? <span className="text-muted-foreground"> — {entry.note}</span> : null}
                  </span>
                  <Button size="sm" variant="subtle" onClick={() => deleteEntry.mutate(entry.id)} aria-label="Удалить запись">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}
