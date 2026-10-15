import { Injectable, NotFoundException } from "@nestjs/common";
import type { HealthMeasurement as MeasurementRow, HealthTarget as TargetRow } from "@prisma/client";
import {
  healthMeasurementKindSchema,
  type CreateHealthMeasurementInput,
  type HealthMeasurement,
  type HealthMeasurementKind,
  type HealthTarget,
  type PutHealthTargetInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { HealthService } from "./health.service";

const MAX_ROWS = 3000;

/**
 * Показатели и личные диапазоны (ADR-0012). Доступ — `assertSubjectTx`: смотреть может любой допущенный, вносить и
 * удалять — `own`/`write`. Значения проверяются на правдоподобие схемой ввода (защита от опечаток, не оценка здоровья).
 */
@Injectable()
export class HealthMeasurementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService
  ) {}

  /** Свежие первыми. `from`/`to` — ISO-момент; `kind` необязателен. Вернётся не больше `MAX_ROWS` записей. */
  async list(userId: string, workspaceId: string, subjectId: string, filter: { kind?: HealthMeasurementKind; from?: string; to?: string }): Promise<HealthMeasurement[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "read");
      const rows = await tx.healthMeasurement.findMany({
        where: {
          subjectId,
          ...(filter.kind ? { kind: filter.kind } : {}),
          ...(filter.from || filter.to ? { measuredAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } } : {})
        },
        orderBy: { measuredAt: "desc" },
        take: MAX_ROWS
      });
      return rows.map(measurementDto);
    });
  }

  async create(userId: string, workspaceId: string, subjectId: string, input: CreateHealthMeasurementInput): Promise<HealthMeasurement> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const row = await tx.healthMeasurement.create({
        data: {
          workspaceId,
          subjectId,
          kind: input.kind,
          value: input.value,
          value2: input.value2,
          measuredAt: input.measuredAt ? new Date(input.measuredAt) : new Date(),
          context: input.context,
          note: input.note
        }
      });
      return measurementDto(row);
    });
  }

  async remove(userId: string, workspaceId: string, subjectId: string, measurementId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const result = await tx.healthMeasurement.deleteMany({ where: { id: measurementId, subjectId } });
      if (result.count === 0) throw new NotFoundException("Запись не найдена");
    });
  }

  async listTargets(userId: string, workspaceId: string, subjectId: string): Promise<HealthTarget[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "read");
      return (await tx.healthTarget.findMany({ where: { subjectId } })).map(targetDto);
    });
  }

  async putTarget(userId: string, workspaceId: string, subjectId: string, kind: HealthMeasurementKind, input: PutHealthTargetInput): Promise<HealthTarget> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const row = await tx.healthTarget.upsert({
        where: { subjectId_kind: { subjectId, kind } },
        create: { workspaceId, subjectId, kind, min: input.min, max: input.max },
        update: { min: input.min, max: input.max }
      });
      return targetDto(row);
    });
  }

  async removeTarget(userId: string, workspaceId: string, subjectId: string, kind: HealthMeasurementKind): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      await tx.healthTarget.deleteMany({ where: { subjectId, kind } });
    });
  }
}

export function measurementDto(row: MeasurementRow): HealthMeasurement {
  return {
    id: row.id,
    subjectId: row.subjectId,
    kind: healthMeasurementKindSchema.catch("weight").parse(row.kind),
    value: row.value.toNumber(),
    value2: row.value2 ? row.value2.toNumber() : null,
    measuredAt: row.measuredAt.toISOString(),
    context: row.context,
    note: row.note,
    createdAt: row.createdAt.toISOString()
  };
}

export function targetDto(row: TargetRow): HealthTarget {
  return {
    subjectId: row.subjectId,
    kind: healthMeasurementKindSchema.catch("weight").parse(row.kind),
    min: row.min ? row.min.toNumber() : null,
    max: row.max ? row.max.toNumber() : null
  };
}
