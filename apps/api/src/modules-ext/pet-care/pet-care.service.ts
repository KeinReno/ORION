import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  petCareKindSchema,
  petCareSpeciesSchema,
  type CreatePetCareEntryInput,
  type CreatePetCarePetInput,
  type PetCareEntry,
  type PetCarePet,
  type UpdatePetCarePetInput
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

/** Записей ухода на один запрос; журнал — «последние сверху», выборка по датам — отдельная задача. */
const ENTRY_LIMIT = 500;

/**
 * Pet Care. Те же инварианты, что у любого workspace-модуля: членство проверяется первым,
 * всё идёт через `withUser` (RLS), наружу — DTO, собранный руками (`toPetDto`/`toEntryDto`).
 */
@Injectable()
export class PetCareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async listPets(userId: string, workspaceId: string): Promise<PetCarePet[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.petCarePet.findMany({ where: { workspaceId }, orderBy: [{ createdAt: "asc" }] });
    });
    return rows.map(toPetDto);
  }

  async createPet(userId: string, workspaceId: string, input: CreatePetCarePetInput): Promise<PetCarePet> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.petCarePet.create({
        data: {
          workspaceId,
          name: input.name,
          species: input.species,
          birthday: input.birthday ? dayDate(input.birthday) : null,
          notes: input.notes
        }
      });
    });
    return toPetDto(row);
  }

  async updatePet(userId: string, workspaceId: string, petId: string, input: UpdatePetCarePetInput): Promise<PetCarePet> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      return tx.petCarePet.update({
        where: { id: petId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.species !== undefined ? { species: input.species } : {}),
          ...(input.birthday !== undefined ? { birthday: input.birthday ? dayDate(input.birthday) : null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {})
        }
      });
    });
    return toPetDto(row);
  }

  async deletePet(userId: string, workspaceId: string, petId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      await tx.petCarePet.delete({ where: { id: petId } });
    });
  }

  async listEntries(userId: string, workspaceId: string, petId: string): Promise<PetCareEntry[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      return tx.petCareEntry.findMany({
        where: { workspaceId, petId },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: ENTRY_LIMIT
      });
    });
    return rows.map(toEntryDto);
  }

  async createEntry(userId: string, workspaceId: string, petId: string, input: CreatePetCareEntryInput): Promise<PetCareEntry> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPetTx(tx, workspaceId, petId);
      return tx.petCareEntry.create({
        data: {
          workspaceId,
          petId,
          kind: input.kind,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          note: input.note
        }
      });
    });
    return toEntryDto(row);
  }

  async deleteEntry(userId: string, workspaceId: string, petId: string, entryId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const entry = await tx.petCareEntry.findUnique({ where: { id: entryId } });
      // Запись другого пространства или другого питомца для вызывающего «не существует».
      if (!entry || entry.workspaceId !== workspaceId || entry.petId !== petId) throw new NotFoundException("Запись ухода не найдена");
      await tx.petCareEntry.delete({ where: { id: entryId } });
    });
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

function toPetDto(row: {
  id: string;
  workspaceId: string;
  name: string;
  species: string;
  birthday: Date | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}): PetCarePet {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    // Неизвестный вид (строка из будущей версии) показываем как «другое», а не роняем список.
    species: petCareSpeciesSchema.catch("other").parse(row.species),
    birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toEntryDto(row: {
  id: string;
  workspaceId: string;
  petId: string;
  kind: string;
  occurredAt: Date;
  note: string;
  createdAt: Date;
}): PetCareEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    petId: row.petId,
    kind: petCareKindSchema.catch("feeding").parse(row.kind),
    occurredAt: row.occurredAt.toISOString(),
    note: row.note,
    createdAt: row.createdAt.toISOString()
  };
}
