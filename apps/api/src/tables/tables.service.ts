import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  computeTableFormulas,
  coerceCsvCell,
  parseTableCsv,
  tableColumnsSchema,
  tableToCsv,
  validateTableRowValues,
  type CreateTableInput,
  type CreateTableRowInput,
  type ImportTableCsvInput,
  type ImportTableCsvResult,
  type TableColumn,
  type TableDefinition,
  type TableReadResult,
  type TableRow,
  type TableRowValues,
  type UpdateTableInput,
  type UpdateTableRowInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { ProjectReferences } from "../projects/public/project-references";
import { TaskReferenceReader } from "../tasks/public/task-reference-reader";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** Шаг ручного порядка строк — как у списков и задач. */
const ROW_POSITION_STEP = 1_000;

type TableDefinitionRow = {
  id: string;
  workspaceId: string;
  name: string;
  columns: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

type TableRowRow = {
  id: string;
  workspaceId: string;
  tableId: string;
  values: Prisma.JsonValue;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Задание 10.1 — Orion Tables (общий инструмент, а не предметный модуль).
 *
 * Инварианты обычного workspace-модуля: членство проверяется первым, всё
 * выполняется в `withUser`-транзакции (RLS — вторая линия), наружу выходят
 * только DTO, входы валидируются zod-схемами из `shared-types`.
 *
 * Чего здесь намеренно нет:
 * - хранения вычисленных формул: значения считаются при чтении общей функцией
 *   `computeTableFormulas`, поэтому «sum» в API и в CSV-экспорте не расходятся;
 * - прямых запросов в таблицы задач/проектов для link-колонок: существование
 *   проверяется публичными контрактами владельцев (`TaskReferenceReader`,
 *   `ProjectReferences`), как требует задание;
 * - XLSX: в API-пакете нет рантайм-зависимости для него, поэтому экспорт
 *   ограничен CSV (см. `docs/platform-api/ORION_TOOLS.md`, «Отложено»).
 */
@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly events: DomainEventBus,
    private readonly tasks: TaskReferenceReader,
    private readonly projects: ProjectReferences
  ) {}

  async list(userId: string, workspaceId: string): Promise<TableDefinition[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.tableDefinition.findMany({
        where: { workspaceId },
        orderBy: [{ updatedAt: "desc" }],
        include: { _count: { select: { rows: true } } }
      });
      return rows.map((row) => toDefinition(row, row._count.rows));
    });
  }

  async get(userId: string, workspaceId: string, tableId: string): Promise<TableReadResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const table = await this.tableTx(tx, workspaceId, tableId);
      const rows = await tx.tableRow.findMany({
        where: { workspaceId, tableId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }]
      });
      return readResult(table, rows);
    });
  }

  async create(userId: string, workspaceId: string, input: CreateTableInput): Promise<TableDefinition> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const columns = tableColumnsSchema.parse(input.columns);
      const row = await tx.tableDefinition.create({
        data: { workspaceId, name: input.name, columns: columns as unknown as Prisma.InputJsonValue }
      });
      return toDefinition(row, 0);
    });
  }

  async update(userId: string, workspaceId: string, tableId: string, input: UpdateTableInput): Promise<TableDefinition> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const table = await this.tableTx(tx, workspaceId, tableId);
      const columns = input.columns ? tableColumnsSchema.parse(input.columns) : parseColumns(table.columns);
      const existingRows = input.columns ? await tx.tableRow.findMany({ where: { workspaceId, tableId } }) : [];
      // Смена схемы над данными: сохраняем только колонки нового состава и
      // проверяем значения по новым типам. Молча «потерять» данные нельзя, поэтому
      // несовместимая строка — 422 с номером строки, а не тихое обнуление.
      const normalized = input.columns
        ? existingRows.map((row, index) => {
            const values = normalizeValues(columns, asValues(row.values));
            const issues = validateTableRowValues(columns, values);
            if (issues.length > 0) {
              throw new UnprocessableEntityException({
                message: `Строка ${index + 1} не подходит под новую схему`,
                issues
              });
            }
            return { id: row.id, values };
          })
        : [];
      if (input.columns) {
        for (const row of normalized) {
          await tx.tableRow.update({ where: { id: row.id }, data: { values: row.values as Prisma.InputJsonValue } });
        }
      }
      const updated = await tx.tableDefinition.update({
        where: { id: tableId },
        data: {
          name: input.name,
          ...(input.columns ? { columns: columns as unknown as Prisma.InputJsonValue } : {})
        },
        include: { _count: { select: { rows: true } } }
      });
      return toDefinition(updated, updated._count.rows);
    });
  }

  async remove(userId: string, workspaceId: string, tableId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.tableTx(tx, workspaceId, tableId);
      // Строки удаляются каскадом FK: таблица — владелец своих строк.
      await tx.tableDefinition.delete({ where: { id: tableId } });
    });
  }

  async createRow(userId: string, workspaceId: string, tableId: string, input: CreateTableRowInput): Promise<TableRow> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const table = await this.tableTx(tx, workspaceId, tableId);
      const columns = parseColumns(table.columns);
      const values = normalizeValues(columns, input.values);
      this.assertValues(columns, values);
      await this.assertLinksTx(tx, workspaceId, columns, values);
      const position = input.position ?? (await this.nextPositionTx(tx, tableId));
      const row = await tx.tableRow.create({
        data: { workspaceId, tableId, values: values as Prisma.InputJsonValue, position }
      });
      await this.publishRowChange(tx, workspaceId, userId, tableId, row.id, "created");
      return toRow(row, computeTableFormulas(columns, [values]).rowComputed[0] ?? {});
    });
  }

  async updateRow(
    userId: string,
    workspaceId: string,
    tableId: string,
    rowId: string,
    input: UpdateTableRowInput
  ): Promise<TableRow> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const table = await this.tableTx(tx, workspaceId, tableId);
      const existing = await this.rowTx(tx, workspaceId, tableId, rowId);
      const columns = parseColumns(table.columns);
      // Полная замена значений: частичное слияние оставляло бы в строке колонки,
      // которых клиент больше не видел. PATCH строки = «вот её новые значения».
      const values = normalizeValues(columns, input.values);
      this.assertValues(columns, values);
      await this.assertLinksTx(tx, workspaceId, columns, values);
      const row = await tx.tableRow.update({ where: { id: existing.id }, data: { values: values as Prisma.InputJsonValue } });
      await this.publishRowChange(tx, workspaceId, userId, tableId, row.id, "updated");
      return toRow(row, computeTableFormulas(columns, [values]).rowComputed[0] ?? {});
    });
  }

  async removeRow(userId: string, workspaceId: string, tableId: string, rowId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.tableTx(tx, workspaceId, tableId);
      const row = await this.rowTx(tx, workspaceId, tableId, rowId);
      await tx.tableRow.delete({ where: { id: row.id } });
      await this.publishRowChange(tx, workspaceId, userId, tableId, rowId, "deleted");
    });
  }

  /** Ручной порядок: принимает полный список id «от первого к последнему». */
  async reorderRows(userId: string, workspaceId: string, tableId: string, ids: readonly string[]): Promise<TableReadResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const table = await this.tableTx(tx, workspaceId, tableId);
      const rows = await tx.tableRow.findMany({ where: { workspaceId, tableId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
      const existing = new Set(rows.map((row) => row.id));
      const provided = new Set(ids);
      if (provided.size !== ids.length || provided.size !== existing.size || [...provided].some((id) => !existing.has(id))) {
        throw new UnprocessableEntityException("Порядок должен содержать все строки таблицы ровно по одному разу");
      }
      for (const [index, id] of ids.entries()) {
        await tx.tableRow.update({ where: { id }, data: { position: index * ROW_POSITION_STEP } });
      }
      const ordered = await tx.tableRow.findMany({ where: { workspaceId, tableId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
      return readResult(table, ordered);
    });
  }

  /**
   * Импорт CSV в новую таблицу с явным маппингом колонок: `sourceHeader`
   * каждой колонки ищется в заголовке файла (без учёта регистра), а не по
   * позиции — файлы из Excel и Google Sheets переставляют колонки.
   */
  async importCsv(userId: string, workspaceId: string, input: ImportTableCsvInput): Promise<ImportTableCsvResult> {
    const rows = parseTableCsv(input.csv);
    if (rows.length < 2) throw new UnprocessableEntityException("CSV должен содержать заголовок и хотя бы одну строку данных");
    const header = rows[0]!.map((cell) => cell.trim().toLocaleLowerCase("ru"));
    const indexByHeader = new Map<string, number>();
    header.forEach((name, index) => {
      if (!indexByHeader.has(name)) indexByHeader.set(name, index);
    });
    const columns: TableColumn[] = input.columns.map((column) => ({
      id: column.id,
      name: column.name,
      type: column.type,
      ...(column.options ? { options: column.options } : {}),
      ...(column.linkType ? { linkType: column.linkType } : {})
    }));
    const columnIndexes = columns.map((column, index) => {
      const source = input.columns[index]!.sourceHeader.trim().toLocaleLowerCase("ru");
      const position = indexByHeader.get(source);
      if (position === undefined) {
        throw new UnprocessableEntityException(`В CSV нет колонки «${input.columns[index]!.sourceHeader}»`);
      }
      return position;
    });

    const values: TableRowValues[] = [];
    for (let line = 1; line < rows.length; line += 1) {
      const record: TableRowValues = {};
      for (const [index, column] of columns.entries()) {
        const cell = coerceCsvCell(column, rows[line]![columnIndexes[index]!] ?? "");
        if ("error" in cell) {
          throw new UnprocessableEntityException({
            message: `Строка ${line + 1}, колонка «${column.name}»: ${cell.error}`
          });
        }
        if (cell.value !== null) record[column.id] = cell.value;
      }
      const issues = validateTableRowValues(columns, record);
      if (issues.length > 0) throw new UnprocessableEntityException({ message: `Строка ${line + 1}`, issues });
      values.push(record);
    }

    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      for (const record of values) await this.assertLinksTx(tx, workspaceId, columns, record);
      const table = await tx.tableDefinition.create({
        data: { workspaceId, name: input.name, columns: columns as unknown as Prisma.InputJsonValue }
      });
      for (const [index, record] of values.entries()) {
        await tx.tableRow.create({
          data: { workspaceId, tableId: table.id, values: record as Prisma.InputJsonValue, position: index * ROW_POSITION_STEP }
        });
      }
      return { definition: toDefinition(table, values.length), importedRows: values.length };
    });
  }

  async exportCsv(userId: string, workspaceId: string, tableId: string): Promise<{ filename: string; csv: string }> {
    const read = await this.get(userId, workspaceId, tableId);
    const columns = read.definition.columns;
    const csv = tableToCsv(
      columns,
      read.rows.map((row) => row.values),
      { rowComputed: read.rows.map((row) => row.computed), totals: read.totals }
    );
    return { filename: `${read.definition.name}.csv`, csv };
  }

  // -------------------------------------------------------------------------

  private async tableTx(tx: Prisma.TransactionClient, workspaceId: string, tableId: string): Promise<TableDefinitionRow> {
    const table = await tx.tableDefinition.findFirst({ where: { id: tableId, workspaceId } });
    if (!table) throw new NotFoundException("Таблица не найдена");
    return table;
  }

  private async rowTx(tx: Prisma.TransactionClient, workspaceId: string, tableId: string, rowId: string): Promise<TableRowRow> {
    const row = await tx.tableRow.findFirst({ where: { id: rowId, workspaceId, tableId } });
    if (!row) throw new NotFoundException("Строка таблицы не найдена");
    return row;
  }

  private async nextPositionTx(tx: Prisma.TransactionClient, tableId: string): Promise<number> {
    const last = await tx.tableRow.findFirst({ where: { tableId }, orderBy: { position: "desc" }, select: { position: true } });
    return (last?.position ?? 0) + ROW_POSITION_STEP;
  }

  private assertValues(columns: readonly TableColumn[], values: TableRowValues): void {
    const issues = validateTableRowValues(columns, values);
    if (issues.length > 0) throw new UnprocessableEntityException({ message: "Значения не подходят под схему таблицы", issues });
  }

  /**
   * Существование ссылок проверяют владельцы сущностей, а не таблицы: задачи —
   * `TaskReferenceReader`, проекты — `ProjectReferences`. Чужой id из другого
   * пространства не проходит: оба контракта ограничены `workspaceId`.
   */
  private async assertLinksTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    columns: readonly TableColumn[],
    values: TableRowValues
  ): Promise<void> {
    const taskIds = collectLinkIds(columns, values, "task");
    if (taskIds.length > 0) {
      const tasks = await this.tasks.byIdsTx(tx, workspaceId, taskIds);
      const found = new Set(tasks.map((task) => task.id));
      const missing = taskIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw new UnprocessableEntityException(`Задача не найдена в этом пространстве: ${missing.join(", ")}`);
    }
    const projectIds = collectLinkIds(columns, values, "project");
    for (const projectId of projectIds) {
      if (!(await this.projects.existsTx(tx, workspaceId, projectId))) {
        throw new UnprocessableEntityException(`Проект не найден в этом пространстве: ${projectId}`);
      }
    }
  }

  private async publishRowChange(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
    tableId: string,
    rowId: string,
    action: "created" | "updated" | "deleted"
  ): Promise<void> {
    await this.events.publishTx(tx, {
      workspaceId,
      type: "table.row_changed",
      actorId: userId,
      payload: { tableId, rowId, action }
    });
  }
}

function parseColumns(value: Prisma.JsonValue): TableColumn[] {
  const parsed = tableColumnsSchema.safeParse(value);
  if (!parsed.success) {
    // Схема пишется только через этот сервис, поэтому сюда попадает лишь ручная
    // правка БД. Отвечаем 422 с причиной, а не 500 и не пустой таблицей.
    throw new UnprocessableEntityException({ message: "Схема таблицы повреждена", issues: parsed.error.flatten() });
  }
  return parsed.data;
}

function asValues(value: Prisma.JsonValue): TableRowValues {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as TableRowValues) : {};
}

/** Оставляет только колонки схемы и выбрасывает пустые значения: JSON строки не растёт от null-ов. */
function normalizeValues(columns: readonly TableColumn[], values: TableRowValues): TableRowValues {
  const result: TableRowValues = {};
  for (const column of columns) {
    if (column.type === "formula") continue;
    const value = values[column.id];
    if (value === undefined || value === null) continue;
    result[column.id] = value;
  }
  return result;
}

function collectLinkIds(columns: readonly TableColumn[], values: TableRowValues, linkType: TableColumn["linkType"]): string[] {
  const ids = new Set<string>();
  for (const column of columns) {
    if (column.type !== "link" || column.linkType !== linkType) continue;
    const value = values[column.id];
    if (typeof value === "string" && value.trim()) ids.add(value.trim());
  }
  return [...ids];
}

function readResult(
  table: TableDefinitionRow,
  rows: readonly TableRowRow[]
): TableReadResult {
  const columns = parseColumns(table.columns);
  const storedValues = rows.map((row) => asValues(row.values));
  const computed = computeTableFormulas(columns, storedValues);
  return {
    definition: toDefinition(table, rows.length),
    rows: rows.map((row, index) => toRow(row, computed.rowComputed[index] ?? {})),
    totals: computed.totals
  };
}

function toDefinition(row: TableDefinitionRow, rowCount: number): TableDefinition {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    columns: parseColumns(row.columns),
    rowCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toRow(row: TableRowRow, computed: Record<string, number | null>): TableRow {
  return {
    id: row.id,
    tableId: row.tableId,
    values: asValues(row.values),
    computed,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
