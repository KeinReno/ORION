import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  EISENHOWER_PRESET_ID,
  EISENHOWER_PRESET_NAME,
  EISENHOWER_X_AXIS,
  EISENHOWER_Y_AXIS,
  matrixAxisUnavailableReason,
  planningAxisSchema,
  type CreateMatrixPresetInput,
  type MatrixPreset,
  type PlanningAxis,
  type UpdateMatrixPresetInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { TaskFieldReader } from "../tasks/public/task-field-reader";

type PresetRow = Prisma.PlanningMatrixPresetGetPayload<Record<string, never>>;

/**
 * Пресеты осей матрицы (задание 04, п. 4.3).
 *
 * Встроенный «Эйзенхауэр» не хранится в базе: его нельзя удалить, переименовать
 * или испортить неполным PATCH, и после восстановления бэкапа он существует по
 * определению. Пользовательские пресеты — обычные строки пространства.
 *
 * Ось `customFieldId` проверяется по реальному справочнику полей Tasks 2.0 через
 * публичный `TaskFieldReader`: если поля нет, это 409 с объяснением, а не пустая
 * ось, на которой «все задачи в одном квадранте».
 */
@Injectable()
export class PlanningMatrixPresetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly taskFields: TaskFieldReader
  ) {}

  async list(userId: string, workspaceId: string): Promise<MatrixPreset[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return [builtInPreset(), ...(await this.customPresetsTx(tx, workspaceId)).map(toDto)];
    });
  }

  async create(userId: string, workspaceId: string, input: CreateMatrixPresetInput): Promise<MatrixPreset> {
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        await this.assertAxesAvailableTx(tx, workspaceId, input.xAxis, input.yAxis);
        const row = await tx.planningMatrixPreset.create({
          data: {
            workspaceId,
            name: input.name,
            xAxis: axisJson(input.xAxis),
            yAxis: axisJson(input.yAxis),
            sortOrder: (await tx.planningMatrixPreset.count({ where: { workspaceId } })) * 10
          }
        });
        return toDto(row);
      });
    } catch (error) {
      throw asConflict(error, "Пресет с таким названием уже есть");
    }
  }

  async update(userId: string, workspaceId: string, presetId: string, input: UpdateMatrixPresetInput): Promise<MatrixPreset> {
    this.assertNotBuiltIn(presetId);
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const current = await this.assertPresetTx(tx, workspaceId, presetId);
        const xAxis = input.xAxis ?? parseAxis(current.xAxis, "x");
        const yAxis = input.yAxis ?? parseAxis(current.yAxis, "y");
        if (input.xAxis || input.yAxis) await this.assertAxesAvailableTx(tx, workspaceId, xAxis, yAxis);
        const row = await tx.planningMatrixPreset.update({
          where: { id: presetId },
          data: {
            name: input.name,
            xAxis: input.xAxis ? axisJson(input.xAxis) : undefined,
            yAxis: input.yAxis ? axisJson(input.yAxis) : undefined
          }
        });
        return toDto(row);
      });
    } catch (error) {
      throw asConflict(error, "Пресет с таким названием уже есть");
    }
  }

  async remove(userId: string, workspaceId: string, presetId: string): Promise<void> {
    this.assertNotBuiltIn(presetId);
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPresetTx(tx, workspaceId, presetId);
      await tx.planningMatrixPreset.delete({ where: { id: presetId } });
    });
  }

  /** Пресет для чтения матрицы: встроенный по id, иначе — свой в этом пространстве. */
  async resolveTx(tx: Prisma.TransactionClient, workspaceId: string, presetId: string): Promise<MatrixPreset> {
    if (presetId === EISENHOWER_PRESET_ID) return builtInPreset();
    const row = await tx.planningMatrixPreset.findUnique({ where: { id: presetId } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Пресет матрицы не найден");
    return toDto(row);
  }

  /** 409 с причиной, если ось ссылается на несуществующее пользовательское поле. */
  async assertAxesAvailableTx(tx: Prisma.TransactionClient, workspaceId: string, xAxis: PlanningAxis, yAxis: PlanningAxis): Promise<void> {
    const fieldIds = (await this.taskFields.fieldsTx(tx, workspaceId)).map((field) => field.id);
    for (const axis of [xAxis, yAxis]) {
      const reason = matrixAxisUnavailableReason(axis, fieldIds);
      if (reason) throw new ConflictException({ code: "planning_axis_unavailable", message: reason });
    }
  }

  private assertNotBuiltIn(presetId: string): void {
    if (presetId === EISENHOWER_PRESET_ID) {
      throw new ConflictException({
        code: "planning_preset_builtin",
        message: `Встроенный пресет «${EISENHOWER_PRESET_NAME}» нельзя изменить или удалить`
      });
    }
  }

  private async customPresetsTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<PresetRow[]> {
    return tx.planningMatrixPreset.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  private async assertPresetTx(tx: Prisma.TransactionClient, workspaceId: string, presetId: string): Promise<PresetRow> {
    const row = await tx.planningMatrixPreset.findUnique({ where: { id: presetId } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Пресет матрицы не найден");
    return row;
  }
}

export function builtInPreset(): MatrixPreset {
  return {
    id: EISENHOWER_PRESET_ID,
    workspaceId: null,
    name: EISENHOWER_PRESET_NAME,
    builtIn: true,
    xAxis: EISENHOWER_X_AXIS,
    yAxis: EISENHOWER_Y_AXIS,
    createdAt: null,
    updatedAt: null
  };
}

function axisJson(axis: PlanningAxis): Prisma.InputJsonValue {
  return { field: axis.field, kind: axis.kind };
}

function toDto(row: PresetRow): MatrixPreset {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    builtIn: false,
    xAxis: parseAxis(row.xAxis, "x"),
    yAxis: parseAxis(row.yAxis, "y"),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function parseAxis(value: Prisma.JsonValue, axis: "x" | "y"): PlanningAxis {
  const parsed = planningAxisSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Повреждённая ось ${axis} в пресете матрицы`);
  return parsed.data;
}

/** P2002 (уникальное имя) → понятный 409 вместо 500. */
function asConflict(error: unknown, message: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new ConflictException({ code: "planning_preset_name_taken", message });
  }
  return error;
}
