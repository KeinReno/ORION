"use client";

import { PET_SPECIES_LABELS, type PetCarePet } from "@orion/shared-types";
import { Button, ConfirmDialog, EmptyState, Modal, PanelBody, PanelHeader, PanelShell, SegmentedControl, Skeleton, useToast } from "@orion/ui";
import { FileUp, PawPrint, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "../../lib/error-message";
import { formatPetDay, petAgeLabel } from "../../lib/pet-care-days";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { PetCareJournal } from "./care-journal";
import { PetDiaryTab } from "./diary-tab";
import { PetEventsTab } from "./events";
import { PetMurhpImport } from "./import-murhp";
import { PetForm, petToFormValues, type PetFormValues } from "./pet-form";
import { PetReportTab } from "./report-tab";
import { PetStatsTab } from "./stats-tab";
import { useCreatePetCarePet, useDeletePetCarePet, usePetCarePets, useUpdatePetCarePet } from "./use-pet-care";

type Tab = "diary" | "stats" | "events" | "report" | "care" | "profile";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "diary", label: "Дневник" },
  { value: "stats", label: "Статистика" },
  { value: "events", label: "События" },
  { value: "report", label: "Отчёт" },
  { value: "care", label: "Уход" },
  { value: "profile", label: "Профиль" }
];

/** «4,2» / «4.2» → 4.2; empty or out of range → null (not set). */
function parseWeight(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  return raw.trim() !== "" && Number.isFinite(value) && value >= 0.01 && value <= 200 ? value : null;
}

const toInput = (values: PetFormValues) => ({
  name: values.name,
  species: values.species,
  birthday: values.birthday || null,
  breed: values.breed,
  vetContact: values.vetContact,
  chronic: values.chronic,
  allergies: values.allergies,
  weightKg: parseWeight(values.weight),
  notes: values.notes
});

/**
 * Pet Care: питомцы пространства, журнал ухода и дневник самочувствия (перенос MurHP).
 * Подключается генерируемым `modules-ext/panels.generated.ts`, а не строкой в `panel-registry.ts`.
 */
export function PetCarePanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const pets = usePetCarePets(workspaceId);
  const createPet = useCreatePetCarePet(workspaceId);
  const [creating, setCreating] = useState(false);
  const [petId, setPetId] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>("diary");

  const list = pets.data ?? [];
  // Выбранного питомца могли удалить (в другом окне) — тогда берём первого, а не показываем пустоту.
  const pet = list.find((item) => item.id === petId) ?? list[0];
  useEffect(() => {
    if (pet && pet.id !== petId) setPetId(pet.id);
  }, [pet, petId]);

  async function submit(values: PetFormValues): Promise<void> {
    try {
      const created = await createPet.mutateAsync(toInput(values));
      setCreating(false);
      setPetId(created.id);
      setTab("diary");
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
        subtitle="Дневник самочувствия, журнал ухода и отчёт для ветеринара"
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
        ) : !pet ? (
          <EmptyState
            icon={PawPrint}
            title="Питомцев пока нет"
            description="Добавьте питомца, отмечайте его самочувствие по дням и записывайте кормление, визиты, лекарства и прогулки. Дневник из MurHP можно перенести импортом."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Новый питомец
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {list.length > 1 ? (
                  <SegmentedControl
                    aria-label="Питомец"
                    options={list.map((item) => ({ value: item.id, label: item.name }))}
                    value={pet.id}
                    onChange={setPetId}
                  />
                ) : (
                  <span className="text-sm font-medium">{pet.name}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {[PET_SPECIES_LABELS[pet.species], pet.breed, petAgeLabel(pet.birthday)].filter(Boolean).join(" · ")}
                </span>
              </div>
              <SegmentedControl aria-label="Раздел" options={TABS} value={tab} onChange={setTab} />
            </div>

            {/* key: при смене питомца внутренние состояния вкладок (выбранный день, период) не должны переезжать на другого. */}
            <div key={pet.id}>
              {tab === "diary" ? <PetDiaryTab workspaceId={workspaceId} pet={pet} /> : null}
              {tab === "stats" ? <PetStatsTab workspaceId={workspaceId} pet={pet} /> : null}
              {tab === "events" ? <PetEventsTab workspaceId={workspaceId} pet={pet} /> : null}
              {tab === "report" ? <PetReportTab workspaceId={workspaceId} pet={pet} /> : null}
              {tab === "care" ? <PetCareJournal workspaceId={workspaceId} pet={pet} /> : null}
              {tab === "profile" ? <PetProfile workspaceId={workspaceId} pet={pet} /> : null}
            </div>
          </div>
        )}
      </PanelBody>

      <Modal open={creating} onClose={() => setCreating(false)} title="Новый питомец">
        <PetForm initial={petToFormValues()} busy={createPet.isPending} submitLabel="Добавить" onSubmit={submit} onCancel={() => setCreating(false)} />
      </Modal>
    </PanelShell>
  );
}

function PetProfile({ workspaceId, pet }: { workspaceId: string; pet: PetCarePet }): React.ReactElement {
  const { toast } = useToast();
  const update = useUpdatePetCarePet(workspaceId);
  const remove = useDeletePetCarePet(workspaceId);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(values: PetFormValues): Promise<void> {
    try {
      await update.mutateAsync({ petId: pet.id, input: toInput(values) });
      toast({ title: "Профиль сохранён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить профиль", description: describeError(error), tone: "danger" });
    }
  }

  async function removePet(): Promise<void> {
    setConfirmDelete(false);
    try {
      await remove.mutateAsync(pet.id);
    } catch (error) {
      toast({ title: "Не удалось удалить питомца", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-4">
      {/* key: после сохранения или смены питомца форма читает свежие значения. */}
      <PetForm key={`${pet.id}:${pet.updatedAt}`} initial={petToFormValues(pet)} busy={update.isPending} submitLabel="Сохранить профиль" onSubmit={save} />

      <section className="rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">Перенос из MurHP</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Откройте MurHP → Настройки → «Экспорт копии (.json)» и выберите этот файл здесь. Дни и события добавятся к дневнику, пустые поля профиля заполнятся.
        </p>
        <Button className="mt-2" size="sm" variant="outline" onClick={() => setImporting(true)}>
          <FileUp className="h-4 w-4" /> Импортировать копию MurHP
        </Button>
      </section>

      <section className="rounded-lg border border-destructive/30 p-3">
        <h3 className="text-sm font-semibold">Удаление</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Питомец {pet.birthday ? `(родился ${formatPetDay(pet.birthday)}) ` : ""}будет удалён вместе с дневником, событиями и журналом ухода. Отменить нельзя.
        </p>
        <Button className="mt-2" size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" /> Удалить питомца
        </Button>
      </section>

      <PetMurhpImport open={importing} onClose={() => setImporting(false)} workspaceId={workspaceId} pet={pet} />
      <ConfirmDialog
        open={confirmDelete}
        title={`Удалить «${pet.name}»?`}
        description="Вместе с питомцем удалятся дневник самочувствия, события и журнал ухода."
        onConfirm={() => void removePet()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
