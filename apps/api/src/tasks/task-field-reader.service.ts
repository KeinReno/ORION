import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskFieldReader, type TaskFieldScalar, type TaskFieldSummary, type TaskFieldValueMap } from "./public/task-field-reader";

/**
 * Реализация публичного `TaskFieldReader` (см. `public/task-field-reader.ts`).
 * Живёт в модуле Tasks, потому что таблицы полей — его: architecture-check
 * запрещает чужим модулям читать `task_field_*` напрямую.
 */
@Injectable()
export class TaskFieldQueries extends TaskFieldReader {
  async fieldsTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<TaskFieldSummary[]> {
    const rows = await tx.taskFieldDefinition.findMany({
      where: { workspaceId },
      select: { id: true, name: true, type: true, applicability: true, projectId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as string,
      applicability: row.applicability as string,
      projectId: row.projectId
    }));
  }

  async valuesTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: readonly string[]): Promise<TaskFieldValueMap> {
    if (taskIds.length === 0) return {};
    const rows = await tx.taskFieldValue.findMany({
      where: { workspaceId, taskId: { in: [...taskIds] } },
      select: { taskId: true, fieldId: true, valueJson: true }
    });
    const out: TaskFieldValueMap = {};
    for (const row of rows) {
      const bucket = out[row.taskId] ?? {};
      bucket[row.fieldId] = scalar(row.valueJson);
      out[row.taskId] = bucket;
    }
    return out;
  }
}

/** Только скаляры: `multi`/объект осью матрицы быть не может (значение — `null`). */
function scalar(value: Prisma.JsonValue | null): TaskFieldScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  return null;
}
