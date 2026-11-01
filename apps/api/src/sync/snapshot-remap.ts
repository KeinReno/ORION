import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { SNAPSHOT_MODEL_REGISTRY } from "./snapshot-registry";
import type { WorkspaceSnapshot } from "./snapshot.service";

/**
 * ТЗ-05 §5.5 — перенос пространства на другой узел как НОВОГО пространства.
 *
 * Снапшот одного узла нельзя просто вставить на другой: первичные ключи глобальны,
 * а пользователи и участники там другие. Поэтому каждая строка получает новый id,
 * все внешние ключи переписываются по схеме Prisma (DMMF — не по ручному списку,
 * забытая связь ломает проверку, а не молча тянет старый id), а авторство
 * переписывается на импортирующего. Чистая функция: без БД и файлов.
 */

/** Полиморфные ссылки (тип + id), которые не видны как внешние ключи. */
const POLYMORPHIC: Record<string, Array<{ type: string; id: string; drop: boolean }>> = {
  EntityLink: [
    { type: "sourceType", id: "sourceId", drop: true },
    { type: "targetType", id: "targetId", drop: true }
  ],
  EntityReminder: [{ type: "entityType", id: "entityId", drop: true }],
  // kind is "project" | "task"; idMap is global, so the old entity id is enough.
  DevelopmentCatalogMapping: [{ type: "kind", id: "entityId", drop: true }],
  Capture: [{ type: "anchorType", id: "anchorId", drop: false }],
  InboxItem: [{ type: "targetType", id: "targetId", drop: false }]
};

/**
 * Колонки с id человека БЕЗ внешнего ключа (Prisma их связью не считает). Без переписывания
 * личный счёт остался бы «чужим» (RLS показывает его только ownerId), а таймер — без владельца.
 * Доли/расчёты общих расходов (FinanceSplit*) намеренно не трогаются: там id — «кто из людей», а не автор.
 */
const PLAIN_USER_FIELDS: Record<string, string[]> = {
  Account: ["ownerId"],
  TimeEntry: ["userId"],
  OpportunityProfile: ["ownerUserId"]
};

/** Модели, которые не переносятся даже если попали в файл (выдают доступ внешним людям). */
const NEVER_IMPORTED = new Set(["CrossWorkspaceGrant", "SharedPublication", "SharedPublicationPin", "SharedPublicationOperation"]);

export interface RemapContext {
  newWorkspaceId: string;
  importerUserId: string;
  /** id строки WorkspaceMember импортирующего в новом пространстве (на неё ссылается, например, Task.assigneeId). */
  importerMemberId: string;
}

export interface RemapReport {
  rows: number;
  /** Ссылки на пользователей/участников, переписанные на импортирующего. */
  reassignedToImporter: number;
  /** Необязательные ссылки на то, чего нет в файле, — обнулены. */
  clearedReferences: number;
  /** Связи/напоминания, чья вторая сторона не попала в файл, — не перенесены. */
  droppedRows: number;
  /** Обязательные ссылки на отсутствующие строки — перенос невозможен. */
  problems: string[];
  /** Модели, строки которых сознательно не переносятся. */
  skippedModels: string[];
}

export interface RemapResult {
  tables: Record<string, unknown[]>;
  /** старый id → новый id, для всех перенесённых строк. */
  idMap: Map<string, string>;
  report: RemapReport;
}

interface FieldInfo {
  name: string;
  isRequired: boolean;
  fromFields: string[];
  targetModel: string;
}

function modelInfo(): Map<string, { idField: string | null; relations: FieldInfo[] }> {
  const out = new Map<string, { idField: string | null; relations: FieldInfo[] }>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const idField = model.fields.find((f) => f.isId)?.name ?? null;
    const relations: FieldInfo[] = [];
    for (const field of model.fields) {
      if (field.kind !== "object" || !field.relationFromFields?.length) continue;
      relations.push({ name: field.name, isRequired: field.isRequired, fromFields: [...field.relationFromFields], targetModel: field.type });
    }
    out.set(model.name, { idField, relations });
  }
  return out;
}

/** Ключи таблиц снапшота → имя модели Prisma (из реестра классификации). */
function tableModels(): Array<{ key: string; model: string }> {
  return SNAPSHOT_MODEL_REGISTRY.filter((c) => c.policy === "included" && c.snapshotKey).map((c) => ({ key: c.snapshotKey!, model: c.model }));
}

export function remapSnapshot(snapshot: WorkspaceSnapshot, ctx: RemapContext): RemapResult {
  const info = modelInfo();
  const models = tableModels();
  const report: RemapReport = { rows: 0, reassignedToImporter: 0, clearedReferences: 0, droppedRows: 0, problems: [], skippedModels: [] };
  const idMap = new Map<string, string>();
  // model → set of old ids (чтобы различать «нет в файле» и «есть, но другой модели»)
  const idsByModel = new Map<string, Set<string>>();

  // Проход 1: новые id для всех строк.
  for (const { key, model } of models) {
    if (NEVER_IMPORTED.has(model)) continue;
    const idField = info.get(model)?.idField;
    if (!idField) continue;
    const set = new Set<string>();
    for (const row of (snapshot.tables[key] ?? []) as Array<Record<string, unknown>>) {
      if (row.workspaceId !== snapshot.workspaceId) continue; // страховка: чужие строки в файле игнорируем
      const old = row[idField];
      if (typeof old !== "string") continue;
      idMap.set(old, randomUUID());
      set.add(old);
    }
    idsByModel.set(model, set);
  }

  // Проход 2: переписать поля.
  const tables: Record<string, unknown[]> = {};
  for (const { key, model } of models) {
    if (NEVER_IMPORTED.has(model)) {
      if ((snapshot.tables[key] ?? []).length > 0) report.skippedModels.push(model);
      tables[key] = [];
      continue;
    }
    const meta = info.get(model);
    const out: unknown[] = [];
    for (const source of (snapshot.tables[key] ?? []) as Array<Record<string, unknown>>) {
      if (source.workspaceId !== snapshot.workspaceId) continue;
      const row: Record<string, unknown> = { ...source };
      let dropRow = false;
      if (meta?.idField && typeof row[meta.idField] === "string") row[meta.idField] = idMap.get(row[meta.idField] as string);
      row.workspaceId = ctx.newWorkspaceId;

      for (const rel of meta?.relations ?? []) {
        if (rel.targetModel === "Workspace") continue; // уже выше
        for (const fk of rel.fromFields) {
          if (fk === "workspaceId") continue;
          const old = row[fk];
          if (old === null || old === undefined) continue;
          if (rel.targetModel === "User") {
            row[fk] = ctx.importerUserId;
            report.reassignedToImporter += 1;
          } else if (rel.targetModel === "WorkspaceMember") {
            row[fk] = ctx.importerMemberId;
            report.reassignedToImporter += 1;
          } else if (typeof old === "string" && idsByModel.get(rel.targetModel)?.has(old)) {
            row[fk] = idMap.get(old);
          } else if (rel.isRequired) {
            report.problems.push(`${model}.${fk}: ссылка на отсутствующую в файле строку ${String(old)}`);
          } else {
            row[fk] = null;
            report.clearedReferences += 1;
          }
        }
      }

      const plain = new Set([...(PLAIN_USER_FIELDS[model] ?? []), "createdById"]);
      for (const field of plain) {
        if (typeof row[field] === "string" && !meta?.relations.some((r) => r.fromFields.includes(field))) {
          row[field] = ctx.importerUserId;
          report.reassignedToImporter += 1;
        }
      }

      for (const poly of POLYMORPHIC[model] ?? []) {
        const old = row[poly.id];
        if (old === null || old === undefined) continue;
        const mapped = typeof old === "string" ? idMap.get(old) : undefined;
        if (mapped) {
          row[poly.id] = mapped;
        } else if (poly.drop) {
          dropRow = true;
        } else {
          row[poly.id] = null;
          row[poly.type] = null;
          report.clearedReferences += 1;
        }
      }

      if (dropRow) {
        report.droppedRows += 1;
        continue;
      }
      out.push(row);
    }
    tables[key] = out;
    report.rows += out.length;
  }

  // Версии документов хранят ключ файла со старым workspaceId/documentId.
  tables["documentVersions"] = (tables["documentVersions"] ?? []).map((v) => {
    const row = v as Record<string, unknown>;
    return { ...row, storageKey: remapBlobKey(String(row.storageKey), snapshot.workspaceId, ctx.newWorkspaceId, idMap) };
  });

  return { tables, idMap, report };
}

/**
 * Ключ файла в хранилище: `<ws>/путь/по/папкам/имя`, `<ws>/.trash/<docId>`,
 * `<ws>/.versions/<docId>/<n>` → тот же путь под новым пространством и новыми id документов.
 */
export function remapBlobKey(key: string, oldWorkspaceId: string, newWorkspaceId: string, idMap: Map<string, string>): string {
  const parts = key.split("/");
  if (parts[0] !== oldWorkspaceId) throw new Error(`Ключ файла ${key} не принадлежит пространству ${oldWorkspaceId}`);
  parts[0] = newWorkspaceId;
  if ((parts[1] === ".trash" || parts[1] === ".versions") && parts[2]) {
    const mapped = idMap.get(parts[2]);
    if (!mapped) throw new Error(`Файл ${key} ссылается на документ, которого нет в файле переноса`);
    parts[2] = mapped;
  }
  return parts.join("/");
}
