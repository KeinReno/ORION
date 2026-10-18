import { z } from "zod";

/**
 * Pet Care — образец модуля, подключённого манифестом (PLATFORM.md этап 7, PLATFORM_AUDIT G5/G10).
 * Контракт живёт в каталоге модуля; в `@orion/shared-types` он попадает через автогенерируемый
 * `modules-ext/registry.generated.ts`, а не ручной строкой в `index.ts`.
 */

export const PET_SPECIES = ["dog", "cat", "bird", "fish", "rodent", "reptile", "other"] as const;
export const petCareSpeciesSchema = z.enum(PET_SPECIES);
export type PetCareSpecies = z.infer<typeof petCareSpeciesSchema>;

export const PET_SPECIES_LABELS: Record<PetCareSpecies, string> = {
  dog: "Собака",
  cat: "Кошка",
  bird: "Птица",
  fish: "Рыбки",
  rodent: "Грызун",
  reptile: "Рептилия",
  other: "Другое"
};

export const PET_CARE_KINDS = ["feeding", "vet", "medication", "walk"] as const;
export const petCareKindSchema = z.enum(PET_CARE_KINDS);
export type PetCareKind = z.infer<typeof petCareKindSchema>;

export const PET_CARE_KIND_LABELS: Record<PetCareKind, string> = {
  feeding: "Кормление",
  vet: "Ветеринар",
  medication: "Лекарство",
  walk: "Прогулка"
};

/** День рождения — календарный день `ГГГГ-ММ-ДД` (колонка `@db.Date`), без времени и пояса. */
export const petCareDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается дата вида ГГГГ-ММ-ДД");

export const petCarePetSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  species: petCareSpeciesSchema,
  birthday: petCareDaySchema.nullable(),
  notes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type PetCarePet = z.infer<typeof petCarePetSchema>;

export const createPetCarePetInputSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно").max(120),
  species: petCareSpeciesSchema.default("other"),
  birthday: petCareDaySchema.nullable().optional(),
  notes: z.string().max(4000).default("")
});
export type CreatePetCarePetInput = z.infer<typeof createPetCarePetInputSchema>;

export const updatePetCarePetInputSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно").max(120).optional(),
  species: petCareSpeciesSchema.optional(),
  birthday: petCareDaySchema.nullable().optional(),
  notes: z.string().max(4000).optional()
});
export type UpdatePetCarePetInput = z.infer<typeof updatePetCarePetInputSchema>;

export const petCareEntrySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  petId: z.string(),
  kind: petCareKindSchema,
  occurredAt: z.string(),
  note: z.string(),
  createdAt: z.string()
});
export type PetCareEntry = z.infer<typeof petCareEntrySchema>;

export const createPetCareEntryInputSchema = z.object({
  kind: petCareKindSchema,
  /** Когда это было; без значения — сейчас (по часам сервера). */
  occurredAt: z.string().datetime().optional(),
  note: z.string().max(2000).default("")
});
export type CreatePetCareEntryInput = z.infer<typeof createPetCareEntryInputSchema>;

/** Ответ 204 на удаление: клиентам модуля нужна схема «без тела», а `z` они из контракта не берут. */
export const petCareNoContentSchema = z.void();
