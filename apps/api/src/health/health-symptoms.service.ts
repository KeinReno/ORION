import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { HealthSymptom as SymptomRow } from "@prisma/client";
import type { CreateHealthSymptomInput, HealthSymptom, UpdateHealthSymptomInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { HealthService } from "./health.service";

/** Журнал симптомов (ADR-0012): смотреть — любой допущенный, писать — `own`/`write`. Только запись, без выводов. */
@Injectable()
export class HealthSymptomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService
  ) {}

  /** Свежие первыми; `from` — ISO-момент начала окна по `startedAt`. */
  async list(userId: string, workspaceId: string, subjectId: string, from?: string): Promise<HealthSymptom[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "read");
      const rows = await tx.healthSymptom.findMany({
        where: { subjectId, ...(from ? { OR: [{ startedAt: { gte: new Date(from) } }, { endedAt: null }] } : {}) },
        orderBy: { startedAt: "desc" },
        take: 500
      });
      return rows.map(symptomDto);
    });
  }

  async create(userId: string, workspaceId: string, subjectId: string, input: CreateHealthSymptomInput): Promise<HealthSymptom> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const row = await tx.healthSymptom.create({
        data: {
          workspaceId,
          subjectId,
          name: input.name,
          severity: input.severity,
          startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
          endedAt: input.endedAt ? new Date(input.endedAt) : null,
          triggers: input.triggers,
          relief: input.relief,
          note: input.note
        }
      });
      return symptomDto(row);
    });
  }

  async update(userId: string, workspaceId: string, subjectId: string, symptomId: string, input: UpdateHealthSymptomInput): Promise<HealthSymptom> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const current = await tx.healthSymptom.findUnique({ where: { id: symptomId } });
      if (!current || current.subjectId !== subjectId) throw new NotFoundException("Запись не найдена");
      const startedAt = input.startedAt ? new Date(input.startedAt) : current.startedAt;
      const endedAt = input.endedAt !== undefined ? (input.endedAt ? new Date(input.endedAt) : null) : current.endedAt;
      if (endedAt && endedAt < startedAt) {
        throw new BadRequestException("Конец раньше начала");
      }
      const row = await tx.healthSymptom.update({
        where: { id: symptomId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.severity !== undefined ? { severity: input.severity } : {}),
          startedAt,
          endedAt,
          ...(input.triggers !== undefined ? { triggers: input.triggers } : {}),
          ...(input.relief !== undefined ? { relief: input.relief } : {}),
          ...(input.note !== undefined ? { note: input.note } : {})
        }
      });
      return symptomDto(row);
    });
  }

  async remove(userId: string, workspaceId: string, subjectId: string, symptomId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const result = await tx.healthSymptom.deleteMany({ where: { id: symptomId, subjectId } });
      if (result.count === 0) throw new NotFoundException("Запись не найдена");
    });
  }
}

export function symptomDto(row: SymptomRow): HealthSymptom {
  return {
    id: row.id,
    subjectId: row.subjectId,
    name: row.name,
    severity: row.severity,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    triggers: row.triggers,
    relief: row.relief,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
