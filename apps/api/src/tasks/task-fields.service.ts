import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type CreateTaskFieldInput,
  type SetTaskFieldValuesInput,
  type TaskFieldDefinition,
  type TaskFieldType,
  type TaskFieldValueMap,
  type TaskFieldValueScalar,
  type UpdateTaskFieldInput,
  validateTaskFieldValue
} from "@orion/shared-types";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ProjectTaskLinks } from "../projects/public/project-task-links";

/**
 * РџРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёРµ РїРѕР»СЏ Р·Р°РґР°С‡ (Р·Р°РґР°РЅРёРµ 02, 2.3).
 *
 * РћРїСЂРµРґРµР»РµРЅРёРµ РїРѕР»СЏ Р¶РёРІС‘С‚ РІ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРµ (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ вЂ” С‚РѕР»СЊРєРѕ РґР»СЏ РѕРґРЅРѕРіРѕ
 * РїСЂРѕРµРєС‚Р°), Р·РЅР°С‡РµРЅРёРµ вЂ” СЃС‚СЂРѕРєР° РЅР° РїР°СЂСѓ (taskId, fieldId). РўРёРї Рё РІР°СЂРёР°РЅС‚С‹
 * РїСЂРѕРІРµСЂСЏСЋС‚СЃСЏ РѕР±С‰РµР№ С‡РёСЃС‚РѕР№ С„СѓРЅРєС†РёРµР№ `validateTaskFieldValue`, С‡С‚РѕР±С‹ РєР»РёРµРЅС‚ Рё
 * СЃРµСЂРІРµСЂ С‡РёС‚Р°Р»Рё РїСЂР°РІРёР»Р° РѕРґРёРЅР°РєРѕРІРѕ. `valueText` вЂ” РЅРѕСЂРјР°Р»РёР·РѕРІР°РЅРЅС‹Р№ С‚РµРєСЃС‚ РґР»СЏ
 * GIN-РїРѕРёСЃРєР°: РёСЃРєР°С‚СЊ РїРѕ Р·РЅР°С‡РµРЅРёСЏРј РїРѕР»РµР№ РЅСѓР¶РЅРѕ С‚Р°Рє Р¶Рµ, РєР°Рє РїРѕ title/description.
 */

@Injectable()
export class TaskFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly projectLinks: ProjectTaskLinks
  ) {}

  async list(userId: string, workspaceId: string): Promise<TaskFieldDefinition[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.taskFieldDefinition.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    });
    return rows.map(toFieldDto);
  }

  async create(userId: string, workspaceId: string, input: CreateTaskFieldInput): Promise<TaskFieldDefinition> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const duplicate = await tx.taskFieldDefinition.findFirst({
        where: { workspaceId, name: { equals: input.name, mode: "insensitive" } }
      });
      if (duplicate) throw new ConflictException("РџРѕР»Рµ СЃ С‚Р°РєРёРј РЅР°Р·РІР°РЅРёРµРј СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚");
      if (input.projectId) await assertProjectTx(this.projectLinks, tx, workspaceId, input.projectId);
      const last = await tx.taskFieldDefinition.findFirst({ where: { workspaceId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      return tx.taskFieldDefinition.create({
        data: {
          workspaceId,
          name: input.name,
          type: input.type,
          options: input.options as unknown as Prisma.InputJsonValue,
          required: input.required,
          applicability: input.applicability,
          projectId: input.projectId ?? null,
          sortOrder: input.sortOrder ?? (last?.sortOrder ?? 0) + 10
        }
      });
    });
    return toFieldDto(row);
  }

  async update(userId: string, workspaceId: string, fieldId: string, input: UpdateTaskFieldInput): Promise<TaskFieldDefinition> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.requireFieldTx(tx, workspaceId, fieldId);
      if (input.name !== undefined && input.name !== current.name) {
        const duplicate = await tx.taskFieldDefinition.findFirst({
          where: { workspaceId, name: { equals: input.name, mode: "insensitive" }, id: { not: fieldId } }
        });
        if (duplicate) throw new ConflictException("РџРѕР»Рµ СЃ С‚Р°РєРёРј РЅР°Р·РІР°РЅРёРµРј СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚");
      }
      const nextType: TaskFieldType = input.type ?? (current.type as TaskFieldType);
      const nextOptions = input.options ?? readOptions(current.options);
      if ((nextType === "select" || nextType === "multi") && nextOptions.length === 0) {
        throw new BadRequestException("Р”Р»СЏ СЃРїРёСЃРєР° РІС‹Р±РѕСЂР° РЅСѓР¶РЅС‹ РІР°СЂРёР°РЅС‚С‹");
      }
      if (input.projectId) await assertProjectTx(this.projectLinks, tx, workspaceId, input.projectId);
      const updated = await tx.taskFieldDefinition.update({
        where: { id: fieldId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.options !== undefined ? { options: input.options as unknown as Prisma.InputJsonValue } : {}),
          ...(input.required !== undefined ? { required: input.required } : {}),
          ...(input.applicability !== undefined ? { applicability: input.applicability } : {}),
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {})
        }
      });
      // РЎРјРµРЅР° С‚РёРїР°/РІР°СЂРёР°РЅС‚РѕРІ РјРѕРіР»Р° СЃРґРµР»Р°С‚СЊ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ Р·РЅР°С‡РµРЅРёСЏ РЅРµРІР°Р»РёРґРЅС‹РјРё вЂ”
      // РЅРµ СѓРґР°Р»СЏРµРј РёС… РјРѕР»С‡Р°, Р° РїСЂРѕСЃРёРј РїРѕРїСЂР°РІРёС‚СЊ: 409 СЃРѕ СЃС‡С‘С‚С‡РёРєРѕРј.
      if (input.type !== undefined || input.options !== undefined) {
        const invalid: string[] = [];
        const values = await tx.taskFieldValue.findMany({ where: { workspaceId, fieldId } });
        for (const value of values) {
          const checked = validateTaskFieldValue(toValidationShape(updated), value.valueJson);
          if (!checked.ok) invalid.push(value.taskId);
        }
        if (invalid.length) {
          throw new ConflictException({
            code: "task_field_values_invalid",
            message: "РќРѕРІС‹Р№ С‚РёРї РёР»Рё РІР°СЂРёР°РЅС‚С‹ РЅРµ РїРѕРґС…РѕРґСЏС‚ Рє Р·РЅР°С‡РµРЅРёСЏРј СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёС… Р·Р°РґР°С‡",
            fieldId,
            taskIds: invalid.slice(0, 50),
            count: invalid.length
          });
        }
      }
      return updated;
    });
    return toFieldDto(row);
  }

  async remove(userId: string, workspaceId: string, fieldId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.requireFieldTx(tx, workspaceId, fieldId);
      await tx.taskFieldDefinition.delete({ where: { id: fieldId } });
    });
  }

  async getValues(userId: string, workspaceId: string, taskId: string): Promise<TaskFieldValueMap> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertTaskTx(tx, workspaceId, taskId);
      return this.valuesMapTx(tx, workspaceId, taskId);
    });
  }

  async setValues(userId: string, workspaceId: string, taskId: string, input: SetTaskFieldValuesInput): Promise<TaskFieldValueMap> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const task = await assertTaskTx(tx, workspaceId, taskId);
      const fields = await tx.taskFieldDefinition.findMany({ where: { workspaceId } });
      const byId = new Map(fields.map((field) => [field.id, field]));
      for (const item of input.values) {
        const field = byId.get(item.fieldId);
        if (!field) throw new NotFoundException("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРѕРµ РїРѕР»Рµ РЅРµ РЅР°Р№РґРµРЅРѕ");
        assertApplicable(field, task.projectId);
        const checked = validateTaskFieldValue(toValidationShape(field), item.value);
        if (!checked.ok) throw new BadRequestException(checked.message);
        await writeValueTx(tx, workspaceId, taskId, field.id, checked.value, checked.text);
      }
      return this.valuesMapTx(tx, workspaceId, taskId);
    });
  }

  /**
   * РџСЂРѕРІРµСЂРєР° Рё Р·Р°РїРёСЃСЊ Р·РЅР°С‡РµРЅРёР№ РІ С‚СЂР°РЅР·Р°РєС†РёРё СЃРѕР·РґР°РЅРёСЏ/РїСЂР°РІРєРё Р·Р°РґР°С‡Рё.
   * `requireRequired` вЂ” СЃРѕР·РґР°РЅРёРµ: РІСЃРµ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РїСЂРёРјРµРЅРёРјС‹Рµ РїРѕР»СЏ РґРѕР»Р¶РЅС‹ Р±С‹С‚СЊ
   * Р·Р°РїРѕР»РЅРµРЅС‹. РќР° РїСЂР°РІРєРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕСЃС‚СЊ РЅРµ СЂРµС‚СЂРѕР°РєС‚РёРІРЅР°: СЃС‚Р°СЂС‹Рµ Р·Р°РґР°С‡Рё РЅРµ
   * Р»РѕРјР°СЋС‚СЃСЏ РїРѕСЏРІР»РµРЅРёРµРј РЅРѕРІРѕРіРѕ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕРіРѕ РїРѕР»СЏ.
   */
  async validateAndWriteTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    taskId: string,
    projectId: string | null,
    values: TaskFieldValueMap | undefined,
    options: { requireRequired: boolean }
  ): Promise<void> {
    const fields = await tx.taskFieldDefinition.findMany({ where: { workspaceId } });
    const byId = new Map(fields.map((field) => [field.id, field]));
    const provided = new Map<string, unknown>(Object.entries(values ?? {}));

    for (const [fieldId, value] of provided) {
      const field = byId.get(fieldId);
      if (!field) throw new BadRequestException("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРѕРµ РїРѕР»Рµ РЅРµ РЅР°Р№РґРµРЅРѕ");
      assertApplicable(field, projectId);
      const checked = validateTaskFieldValue(toValidationShape(field), value);
      if (!checked.ok) throw new BadRequestException(checked.message);
      await writeValueTx(tx, workspaceId, taskId, field.id, checked.value, checked.text);
      provided.set(fieldId, checked.value);
    }

    if (!options.requireRequired) return;
    for (const field of fields) {
      if (!field.required || !isApplicable(field, projectId)) continue;
      const value = provided.get(field.id);
      const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
      if (empty) throw new BadRequestException(`Р—Р°РїРѕР»РЅРёС‚Рµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕРµ РїРѕР»Рµ В«${field.name}В»`);
    }
  }

  async valuesMapTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<TaskFieldValueMap> {
    const rows = await tx.taskFieldValue.findMany({ where: { workspaceId, taskId } });
    const out: TaskFieldValueMap = {};
    for (const row of rows) out[row.fieldId] = row.valueJson as TaskFieldValueScalar | null;
    return out;
  }

  private async requireFieldTx(tx: Prisma.TransactionClient, workspaceId: string, fieldId: string) {
    const field = await tx.taskFieldDefinition.findFirst({ where: { id: fieldId, workspaceId } });
    if (!field) throw new NotFoundException("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРѕРµ РїРѕР»Рµ РЅРµ РЅР°Р№РґРµРЅРѕ");
    return field;
  }
}

async function assertTaskTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string) {
  const task = await tx.task.findFirst({ where: { id: taskId, workspaceId }, select: { id: true, projectId: true } });
  if (!task) throw new NotFoundException("Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°");
  return task;
}

async function assertProjectTx(
  projectLinks: ProjectTaskLinks,
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string
): Promise<void> {
  const project = await projectLinks.byIdTx(tx, workspaceId, projectId);
  if (!project) throw new NotFoundException("РџСЂРѕРµРєС‚ РЅРµ РЅР°Р№РґРµРЅ");
}

function isApplicable(field: { applicability: string; projectId: string | null }, taskProjectId: string | null): boolean {
  return field.applicability === "all" || (field.projectId !== null && field.projectId === taskProjectId);
}

function assertApplicable(field: { applicability: string; projectId: string | null; name: string }, taskProjectId: string | null): void {
  if (!isApplicable(field, taskProjectId)) {
    throw new BadRequestException(`РџРѕР»Рµ В«${field.name}В» РѕС‚РЅРѕСЃРёС‚СЃСЏ Рє РґСЂСѓРіРѕРјСѓ РїСЂРѕРµРєС‚Сѓ`);
  }
}

async function writeValueTx(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  taskId: string,
  fieldId: string,
  value: TaskFieldValueScalar | null,
  text: string | null
): Promise<void> {
  if (value === null) {
    await tx.taskFieldValue.deleteMany({ where: { workspaceId, taskId, fieldId } });
    return;
  }
  const valueJson = value as Prisma.InputJsonValue;
  await tx.taskFieldValue.upsert({
    where: { taskId_fieldId: { taskId, fieldId } },
    create: { workspaceId, taskId, fieldId, valueJson, valueText: text },
    update: { valueJson, valueText: text }
  });
}

function toValidationShape(field: { type: string; options: Prisma.JsonValue; name: string }) {
  return { type: field.type as TaskFieldType, options: readOptions(field.options), name: field.name };
}

export function readOptions(value: Prisma.JsonValue | undefined): string[] {
  const parsed = z.array(z.string()).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function toFieldDto(row: {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  options: Prisma.JsonValue;
  required: boolean;
  applicability: string;
  projectId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): TaskFieldDefinition {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type as TaskFieldType,
    options: readOptions(row.options),
    required: row.required,
    applicability: row.applicability as TaskFieldDefinition["applicability"],
    projectId: row.projectId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
