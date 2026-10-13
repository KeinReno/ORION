import { z } from "zod";

/**
 * Module «Дом». A home (flat, house, dacha, car) owns only meters and contacts. Chores, shopping
 * lists, things and payments stay in their own modules and point at the home through `homeId`,
 * so the Home page can show and create them in one place without a second copy of anything.
 */
export const HOME_KINDS = ["flat", "house", "country", "car", "other"] as const;
export const homeKindSchema = z.enum(HOME_KINDS);
export type HomeKind = z.infer<typeof homeKindSchema>;

export const HOME_KIND_LABEL: Record<HomeKind, string> = {
  flat: "Квартира",
  house: "Дом",
  country: "Дача",
  car: "Машина",
  other: "Другое"
};

export const METER_KINDS = ["electricity", "water_cold", "water_hot", "gas", "heating", "other"] as const;
export const meterKindSchema = z.enum(METER_KINDS);
export type MeterKind = z.infer<typeof meterKindSchema>;

export const METER_KIND_LABEL: Record<MeterKind, string> = {
  electricity: "Электричество",
  water_cold: "Холодная вода",
  water_hot: "Горячая вода",
  gas: "Газ",
  heating: "Отопление",
  other: "Другое"
};

/** The unit a new meter of this kind starts with; the user may change it. */
export const METER_KIND_UNIT: Record<MeterKind, string> = {
  electricity: "кВт·ч",
  water_cold: "м³",
  water_hot: "м³",
  gas: "м³",
  heating: "Гкал",
  other: ""
};

export const homeSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: homeKindSchema,
  note: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Home = z.infer<typeof homeSchema>;

export const createHomeInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(120),
  kind: homeKindSchema.default("flat"),
  note: z.string().max(4_000).default("")
});
export type CreateHomeInput = z.infer<typeof createHomeInputSchema>;

export const updateHomeInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: homeKindSchema.optional(),
  note: z.string().max(4_000).optional(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateHomeInput = z.infer<typeof updateHomeInputSchema>;

export const meterReadingSchema = z.object({
  id: z.string(),
  value: z.number(),
  readAt: z.string(),
  note: z.string(),
  /** Used since the previous reading; null for the first one. */
  consumption: z.number().nullable()
});
export type MeterReading = z.infer<typeof meterReadingSchema>;

export const meterSchema = z.object({
  id: z.string(),
  homeId: z.string(),
  name: z.string(),
  kind: meterKindSchema,
  unit: z.string(),
  /** Newest first, at most 12. */
  readings: z.array(meterReadingSchema),
  /** Latest reading, null when there is none yet. */
  lastValue: z.number().nullable(),
  lastReadAt: z.string().nullable()
});
export type Meter = z.infer<typeof meterSchema>;

export const createMeterInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(120),
  kind: meterKindSchema.default("other"),
  /** Defaults to the kind's unit when omitted. */
  unit: z.string().trim().max(20).optional()
});
export type CreateMeterInput = z.infer<typeof createMeterInputSchema>;

export const updateMeterInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: meterKindSchema.optional(),
  unit: z.string().trim().max(20).optional()
});
export type UpdateMeterInput = z.infer<typeof updateMeterInputSchema>;

export const createMeterReadingInputSchema = z.object({
  value: z.number().min(0, "Показание не может быть отрицательным").max(1_000_000_000),
  /** Defaults to now. */
  readAt: z.string().datetime().optional(),
  note: z.string().max(500).default("")
});
export type CreateMeterReadingInput = z.infer<typeof createMeterReadingInputSchema>;

export const contactSchema = z.object({
  id: z.string(),
  homeId: z.string(),
  name: z.string(),
  role: z.string(),
  phone: z.string(),
  note: z.string()
});
export type Contact = z.infer<typeof contactSchema>;

export const createContactInputSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно").max(120),
  role: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
  note: z.string().max(2_000).default("")
});
export type CreateContactInput = z.infer<typeof createContactInputSchema>;

export const updateContactInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  note: z.string().max(2_000).optional()
});
export type UpdateContactInput = z.infer<typeof updateContactInputSchema>;

export const HOME_ATTACHABLE = ["task", "list", "inventory", "obligation"] as const;
export const homeAttachableSchema = z.enum(HOME_ATTACHABLE);
export type HomeAttachable = z.infer<typeof homeAttachableSchema>;

export const attachToHomeInputSchema = z.object({ type: homeAttachableSchema, id: z.string().min(1) });
export type AttachToHomeInput = z.infer<typeof attachToHomeInputSchema>;

/**
 * Everything the Home page shows. The four `*Ids` are POINTERS: the page reads the full records
 * through the ordinary tasks / lists / inventory / payments hooks (same cache, same actions), so
 * nothing is duplicated here. An id list is empty when the viewer may not use that module.
 */
export const homeOverviewSchema = z.object({
  home: homeSchema,
  taskIds: z.array(z.string()),
  listIds: z.array(z.string()),
  inventoryIds: z.array(z.string()),
  obligationIds: z.array(z.string()),
  /** Records already attached to ANOTHER home: the «attach existing» pickers leave them out. */
  elsewhere: z.object({
    taskIds: z.array(z.string()),
    listIds: z.array(z.string()),
    inventoryIds: z.array(z.string()),
    obligationIds: z.array(z.string())
  }),
  meters: z.array(meterSchema),
  contacts: z.array(contactSchema)
});
export type HomeOverview = z.infer<typeof homeOverviewSchema>;

/**
 * Readings are cumulative: usage is the difference to the previous reading (by date). Input in any
 * order; the result is sorted newest first, each entry carrying what was used since the one before it.
 */
export function withConsumption<T extends { value: number; readAt: string }>(readings: readonly T[]): Array<T & { consumption: number | null }> {
  const ascending = [...readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
  const out = ascending.map((reading, index) => ({
    ...reading,
    consumption: index === 0 ? null : Math.round((reading.value - ascending[index - 1].value) * 1000) / 1000
  }));
  return out.reverse();
}

/**
 * A new reading must fit between its neighbours by date: a cumulative meter never goes backwards.
 * Returns an explanation in Russian, or null when the reading is acceptable.
 */
export function readingProblem(
  existing: ReadonlyArray<{ value: number; readAt: string }>,
  next: { value: number; readAt: string }
): string | null {
  const before = existing.filter((r) => r.readAt <= next.readAt).sort((a, b) => a.readAt.localeCompare(b.readAt)).pop();
  const after = existing.filter((r) => r.readAt > next.readAt).sort((a, b) => a.readAt.localeCompare(b.readAt))[0];
  if (before && next.value < before.value) return `Показание меньше предыдущего (${before.value}). Счётчик не может идти назад.`;
  if (after && next.value > after.value) return `Показание больше следующего по дате (${after.value}).`;
  return null;
}
