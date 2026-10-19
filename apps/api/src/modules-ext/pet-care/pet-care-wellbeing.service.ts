import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  PET_DAYS_MAX_RANGE,
  addPetDays,
  computePetDayStatus,
  parseMurhpBackup,
  petActivitySchema,
  petAppetiteSchema,
  petDayStatusSchema,
  petDaySymptomSchema,
  petEventTypeSchema,
  petStoolSchema,
  petWaterSchema,
  type CreatePetCareEventInput,
  type ImportMurhpInput,
  type ImportMurhpResult,
  type PetCareDayLog,
  type PetCareEvent,
  type PetCareRangeQuery,
  type UpsertPetCareDayInput
} from "@orion/shared-types";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

/** Окно по умолчанию, если клиент не прислал `from`/`to`: три месяца до сегодняшнего дня сервера (UTC). */
const DEFAULT_WINDOW_DAYS = 90;

/**
 * Pet Care — дневник самочувствия и события питомца (перенос MurHP). Инварианты те же, что у остального модуля:
 * членство первым, всё внутри `withUser` (RLS), питомец проверяется на принадлежность ЭТОМУ пространству, наружу — DTO.
 */
@Injectable()
export class PetCareWellbeingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async listDays(userId: string, workspaceId: string, petId: string, query: PetCareRangeQuery): Promise<PetCareDayLog[]> {
    const { from, to } = resolveRange(query);
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      return tx.petCareDay.findMany({
        where: { workspaceId, petId, day: { gte: dayDate(from), lte: dayDate(to) } },
        orderBy: { day: "asc" }
      });
    });
    return rows.map(toDayDto);
  }

  /** Запись дня заменяется целиком; `ON CONFLICT` по `(petId, day)` делает двойной «Сохранить» безопасным. */
  async upsertDay(userId: string, workspaceId: string, petId: string, day: string, input: UpsertPetCareDayInput): Promise<PetCareDayLog> {
    const data = dayColumns(input);
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      return tx.petCareDay.upsert({
        where: { petId_day: { petId, day: dayDate(day) } },
        create: { workspaceId, petId, day: dayDate(day), ...data },
        update: data
      });
    });
    return toDayDto(row);
  }

  async deleteDay(userId: string, workspaceId: string, petId: string, day: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      const removed = await tx.petCareDay.deleteMany({ where: { workspaceId, petId, day: dayDate(day) } });
      if (removed.count === 0) throw new NotFoundException("Запись за этот день не найдена");
    });
  }

  async listEvents(userId: string, workspaceId: string, petId: string, query: PetCareRangeQuery): Promise<PetCareEvent[]> {
    const { from, to } = resolveRange(query);
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      return tx.petCareEvent.findMany({
        where: { workspaceId, petId, day: { gte: dayDate(from), lte: dayDate(to) } },
        orderBy: [{ day: "desc" }, { createdAt: "desc" }]
      });
    });
    return rows.map(toEventDto);
  }

  async createEvent(userId: string, workspaceId: string, petId: string, input: CreatePetCareEventInput): Promise<PetCareEvent> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      return tx.petCareEvent.create({
        data: { workspaceId, petId, day: dayDate(input.day), type: input.type, title: input.title, note: input.note }
      });
    });
    return toEventDto(row);
  }

  async deleteEvent(userId: string, workspaceId: string, petId: string, eventId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const event = await tx.petCareEvent.findUnique({ where: { id: eventId } });
      // Событие другого пространства или другого питомца для вызывающего «не существует».
      if (!event || event.workspaceId !== workspaceId || event.petId !== petId) throw new NotFoundException("Событие не найдено");
      await tx.petCareEvent.delete({ where: { id: eventId } });
    });
  }

  /**
   * Импорт резервной копии MurHP. Повторный импорт той же копии ничего не дублирует: дни живут по ключу `(питомец, день)`,
   * события сравниваются по содержимому. Профиль дополняет только пустые поля питомца — ничего введённого в ORION не затирается.
   */
  async importMurhp(userId: string, workspaceId: string, petId: string, input: ImportMurhpInput): Promise<ImportMurhpResult> {
    const parsed = parseMurhpBackup(input.backup);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const pet = await this.assertPetTx(tx, workspaceId, petId);

      const dates = parsed.days.map((item) => dayDate(item.day));
      const existing = await tx.petCareDay.findMany({ where: { workspaceId, petId, day: { in: dates } }, select: { day: true } });
      const existingKeys = new Set(existing.map((row) => dayKey(row.day)));
      const toWrite = input.overwrite ? parsed.days : parsed.days.filter((item) => !existingKeys.has(item.day));
      if (input.overwrite && existing.length > 0) {
        await tx.petCareDay.deleteMany({ where: { workspaceId, petId, day: { in: existing.map((row) => row.day) } } });
      }
      if (toWrite.length > 0) {
        await tx.petCareDay.createMany({
          data: toWrite.map((item) => ({ workspaceId, petId, day: dayDate(item.day), ...dayColumns(item.input) }))
        });
      }

      const knownEvents = await tx.petCareEvent.findMany({ where: { workspaceId, petId }, select: { day: true, type: true, title: true, note: true } });
      const seen = new Set(knownEvents.map((row) => eventSignature(dayKey(row.day), row.type, row.title, row.note)));
      const freshEvents = parsed.events.filter((item) => {
        const signature = eventSignature(item.day, item.type, item.title, item.note);
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      });
      if (freshEvents.length > 0) {
        await tx.petCareEvent.createMany({
          data: freshEvents.map((item) => ({ workspaceId, petId, day: dayDate(item.day), type: item.type, title: item.title, note: item.note }))
        });
      }

      const profileFilled = await this.fillProfileTx(tx, pet, parsed.profile);
      return {
        daysCreated: toWrite.length - (input.overwrite ? existing.length : 0),
        daysUpdated: input.overwrite ? existing.length : 0,
        daysSkipped: parsed.days.length - toWrite.length,
        eventsCreated: freshEvents.length,
        eventsSkipped: parsed.events.length - freshEvents.length,
        invalidRows: parsed.invalidRows,
        profileFilled
      };
    });
  }

  private async fillProfileTx(
    tx: Prisma.TransactionClient,
    pet: { id: string; birthday: Date | null; breed: string; vetContact: string; chronic: string; allergies: string; notes: string },
    profile: ReturnType<typeof parseMurhpBackup>["profile"]
  ): Promise<string[]> {
    if (!profile) return [];
    const data: Prisma.PetCarePetUpdateInput = {};
    const filled: string[] = [];
    const fill = (label: string, current: string, incoming: string, key: "breed" | "vetContact" | "chronic" | "allergies" | "notes"): void => {
      if (current.trim() === "" && incoming !== "") {
        data[key] = incoming;
        filled.push(label);
      }
    };
    if (!pet.birthday && profile.birthdate) {
      data.birthday = dayDate(profile.birthdate);
      filled.push("день рождения");
    }
    fill("порода", pet.breed, profile.breed, "breed");
    fill("контакт ветеринара", pet.vetContact, profile.vetContact, "vetContact");
    fill("хронические болезни", pet.chronic, profile.chronic, "chronic");
    fill("аллергии", pet.allergies, profile.allergies, "allergies");
    fill("заметки", pet.notes, profile.notes, "notes");
    if (filled.length > 0) await tx.petCarePet.update({ where: { id: pet.id }, data });
    return filled;
  }

  /** Питомец должен принадлежать ЭТОМУ пространству: член двух пространств видит строки обоих (RLS этого не отличает). */
  private async assertPetTx(tx: Prisma.TransactionClient, workspaceId: string, petId: string) {
    const pet = await tx.petCarePet.findUnique({ where: { id: petId } });
    if (!pet || pet.workspaceId !== workspaceId) throw new NotFoundException("Питомец не найден");
    return pet;
  }
}

/** `ГГГГ-ММ-ДД` → полночь UTC (колонка `@db.Date`). */
function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eventSignature(day: string, type: string, title: string, note: string): string {
  return JSON.stringify([day, type, title, note]);
}

function resolveRange(query: PetCareRangeQuery): { from: string; to: string } {
  const to = query.to ?? (query.from ? addPetDays(query.from, DEFAULT_WINDOW_DAYS - 1) : dayKey(new Date()));
  const from = query.from ?? addPetDays(to, -(DEFAULT_WINDOW_DAYS - 1));
  // Окно «только from» мы достраиваем сами, поэтому предел повторяем здесь, а не только в схеме запроса.
  if (from > to || addPetDays(from, PET_DAYS_MAX_RANGE) <= to) throw new BadRequestException("Недопустимое окно дат");
  return { from, to };
}

/** Колонки записи дня; статус при `statusAuto` считается здесь, чтобы «сырое» значение в БД не расходилось с тем, что видит пользователь. */
function dayColumns(input: UpsertPetCareDayInput) {
  const status = input.statusAuto ? computePetDayStatus(input) : input.status;
  return {
    status,
    statusAuto: input.statusAuto,
    appetite: input.appetite,
    activity: input.activity,
    stool: input.stool,
    water: input.water,
    vomitingCount: input.vomitingCount,
    weightKg: input.weightKg,
    temperature: input.temperature,
    meds: input.meds,
    note: input.note,
    symptoms: input.symptoms as unknown as Prisma.InputJsonValue
  };
}

const symptomsColumnSchema = z.array(petDaySymptomSchema).catch([]);

function toDayDto(row: {
  id: string;
  workspaceId: string;
  petId: string;
  day: Date;
  status: string;
  statusAuto: boolean;
  appetite: string;
  activity: string;
  stool: string;
  water: string;
  vomitingCount: number;
  weightKg: number | null;
  temperature: number | null;
  meds: string;
  note: string;
  symptoms: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): PetCareDayLog {
  // Незнакомые значения справочников (строки из будущей версии) показываем как «не отмечено», а не роняем список.
  const facts = {
    appetite: petAppetiteSchema.catch("").parse(row.appetite),
    activity: petActivitySchema.catch("").parse(row.activity),
    stool: petStoolSchema.catch("").parse(row.stool),
    water: petWaterSchema.catch("").parse(row.water),
    vomitingCount: row.vomitingCount,
    symptoms: symptomsColumnSchema.parse(row.symptoms)
  };
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    petId: row.petId,
    day: dayKey(row.day),
    // Итог всегда по текущим правилам: правка правил не оставляет в БД устаревших «авто»-статусов.
    status: row.statusAuto ? computePetDayStatus(facts) : petDayStatusSchema.catch("normal").parse(row.status),
    statusAuto: row.statusAuto,
    ...facts,
    weightKg: row.weightKg,
    temperature: row.temperature,
    meds: row.meds,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toEventDto(row: {
  id: string;
  workspaceId: string;
  petId: string;
  day: Date;
  type: string;
  title: string;
  note: string;
  createdAt: Date;
}): PetCareEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    petId: row.petId,
    day: dayKey(row.day),
    type: petEventTypeSchema.catch("note").parse(row.type),
    title: row.title,
    note: row.note,
    createdAt: row.createdAt.toISOString()
  };
}
