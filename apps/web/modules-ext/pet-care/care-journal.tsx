"use client";

import { PET_CARE_KINDS, PET_CARE_KIND_LABELS, type PetCareKind, type PetCarePet } from "@orion/shared-types";
import { Button, Input, Select, Skeleton, useToast } from "@orion/ui";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";
import { useCreatePetCareEntry, useDeletePetCareEntry, usePetCareEntries } from "./use-pet-care";

/** Журнал ухода: кормление, ветеринар, лекарство, прогулка — быстрая запись «сейчас» и лента (свежие сверху). */
export function PetCareJournal({ workspaceId, pet }: { workspaceId: string; pet: PetCarePet }): React.ReactElement {
  const { toast } = useToast();
  const [kind, setKind] = useState<PetCareKind>("feeding");
  const [note, setNote] = useState("");
  const entries = usePetCareEntries(workspaceId, pet.id);
  const createEntry = useCreatePetCareEntry(workspaceId, pet.id);
  const deleteEntry = useDeletePetCareEntry(workspaceId, pet.id);

  async function addEntry(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await createEntry.mutateAsync({ kind, note: note.trim() });
      setNote("");
    } catch (error) {
      toast({ title: "Не удалось записать уход", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-3" data-testid={`pet-care-pet-${pet.id}`}>
      <form onSubmit={(event) => void addEntry(event)} className="flex flex-wrap items-center gap-2">
        <Select value={kind} onChange={(event) => setKind(event.target.value as PetCareKind)} aria-label="Вид ухода" className="w-auto">
          {PET_CARE_KINDS.map((item) => (
            <option key={item} value={item}>
              {PET_CARE_KIND_LABELS[item]}
            </option>
          ))}
        </Select>
        <Input className="min-w-[10rem] flex-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Заметка (необязательно)" maxLength={2000} aria-label="Заметка к записи" />
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
  );
}
