import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  PROJECT_TREE_MAX_DEPTH,
  offsetDate,
  projectTemplateDepth,
  projectTemplateStructureSchema,
  startOfUtcDay,
  type CreateProjectFromTemplateInput,
  type CreateProjectTemplateInput,
  type DuplicateProjectInput,
  type ProjectFromTemplateResult,
  type ProjectTemplate,
  type ProjectTemplateNodeInput,
  type ProjectTemplateStructure,
  type ProjectTemplateTask,
  type ProjectTemplateMilestone,
  type UpdateProjectTemplateInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { MilestoneCommands } from "../milestones/public/milestone-commands";
import { TaskOperations } from "../tasks/public/task-operations";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ProjectHierarchyRepository } from "./project-hierarchy.repository";

type Tx = Prisma.TransactionClient;

/** Разрешённая (в датах) структура проекта — то, что реально вставляется в БД. */
interface ProjectPlanNode {
  name: string;
  description: string;
  status: string;
  color: string | null;
  startAt: Date | null;
  dueAt: Date | null;
  milestones: Array<{
    title: string;
    note: string;
    status: "planned" | "in_progress" | "done";
    startAt: Date | null;
    dueAt: Date | null;
    estimatedMinutes: number | null;
  }>;
  tasks: Array<{
    title: string;
    description: string;
    priority: "low" | "normal" | "high";
    status: "backlog" | "todo" | "in_progress" | "done" | "canceled";
    estimatedMinutes: number | null;
    startAt: Date | null;
    dueAt: Date | null;
    milestoneIndex: number | null;
  }>;
  logEntries: Array<{ type: string; text: string; createdAt: Date }>;
  children: ProjectPlanNode[];
}

/**
 * Шаблоны и дублирование структуры (задание 03, 3.2).
 *
 * Шаблон — не проект: своя таблица `project_templates`, права `projects.template.*`.
 * Применение шаблона и дублирование идут ОДНИМ материализатором в ОДНОЙ транзакции:
 * промежуточного состояния «проект без вех» не существует, а ошибка на любом шаге
 * откатывает всё (критерий приёмки №2).
 *
 * Чужие таблицы не пишутся напрямую: задачи — через публичный `TaskOperations`,
 * вехи — через публичный `MilestoneCommands` модуля milestones.
 */
@Injectable()
export class ProjectTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly tasks: TaskOperations,
    private readonly milestones: MilestoneCommands,
    private readonly hierarchy: ProjectHierarchyRepository
  ) {}

  // --- Шаблоны -----------------------------------------------------------------------------------

  async list(userId: string, workspaceId: string, archived = false): Promise<ProjectTemplate[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.projectTemplate.findMany({
        where: { workspaceId, archivedAt: archived ? { not: null } : null },
        orderBy: [{ name: "asc" }, { id: "asc" }]
      });
      return rows.map(toTemplateDto);
    });
  }

  async get(userId: string, workspaceId: string, templateId: string): Promise<ProjectTemplate> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return toTemplateDto(await this.assertTemplateTx(tx, workspaceId, templateId));
    });
  }

  async create(userId: string, workspaceId: string, input: CreateProjectTemplateInput): Promise<ProjectTemplate> {
    const structure = this.validatedStructure(input.structure);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      try {
        const row = await tx.projectTemplate.create({
          data: {
            workspaceId,
            name: input.name,
            description: input.description,
            structure: structure as unknown as Prisma.InputJsonValue,
            createdById: userId
          }
        });
        return toTemplateDto(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictException("Шаблон с таким названием уже существует");
        throw error;
      }
    });
  }

  async update(userId: string, workspaceId: string, templateId: string, input: UpdateProjectTemplateInput): Promise<ProjectTemplate> {
    const structure = input.structure === undefined ? undefined : this.validatedStructure(input.structure);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertTemplateTx(tx, workspaceId, templateId);
      try {
        const row = await tx.projectTemplate.update({
          where: { id: templateId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(structure !== undefined ? { structure: structure as unknown as Prisma.InputJsonValue } : {}),
            ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt ? new Date(input.archivedAt) : null } : {})
          }
        });
        return toTemplateDto(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictException("Шаблон с таким названием уже существует");
        throw error;
      }
    });
  }

  /** Архивация, не удаление: шаблон можно вернуть (`archivedAt: null`). */
  async archive(userId: string, workspaceId: string, templateId: string): Promise<ProjectTemplate> {
    return this.update(userId, workspaceId, templateId, { archivedAt: new Date().toISOString() });
  }

  // --- Создание из шаблона -----------------------------------------------------------------------

  async createFromTemplate(userId: string, workspaceId: string, input: CreateProjectFromTemplateInput): Promise<ProjectFromTemplateResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const template = await this.assertTemplateTx(tx, workspaceId, input.templateId);
      const structure = this.validatedStructure(template.structure, "Повреждённая структура шаблона");
      const base = input.startDate ? startOfUtcDay(input.startDate) : startOfUtcDay(new Date());

      if (input.parentId) {
        await this.assertParentTx(tx, workspaceId, input.parentId);
        await this.hierarchy.lockWorkspaceTx(tx, workspaceId);
        await this.assertDepthForNewNodeTx(tx, workspaceId, input.parentId, projectTemplateDepth(structure));
      }
      if (await this.projectNameTakenTx(tx, workspaceId, input.name)) {
        throw new ConflictException("Проект с таким названием уже существует");
      }

      const plan = this.planFromStructure(structure, base, input.name);
      const counts = { projects: 0, milestones: 0, tasks: 0, logEntries: 0 };
      const projectId = await this.materializeTx(tx, userId, workspaceId, plan, input.parentId ?? null, counts, true);
      return { projectId, created: counts };
    });
  }

  // --- Дублирование ------------------------------------------------------------------------------

  /**
   * Копия структуры: вехи и задачи со сдвигами от старта, дочерние проекты — по флагу.
   * По умолчанию НЕ копируется содержимое (описания, заметки) — копия структуры не
   * должна тиражировать текст оригинала; `withContent` включает это явно. Авторы,
   * исполнители, комментарии и вложения не копируются никогда: у копии их просто нет.
   */
  async duplicate(userId: string, workspaceId: string, projectId: string, input: DuplicateProjectInput): Promise<ProjectFromTemplateResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const source = await tx.project.findUnique({ where: { id: projectId } });
      if (!source || source.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");

      const base = startOfUtcDay(input.startDate ?? source.startAt ?? new Date());
      const shift = input.startDate !== undefined;
      const desiredName = input.name ?? `${source.name} — копия`;
      const name = await this.uniqueProjectNameTx(tx, workspaceId, desiredName);
      const counts = { projects: 0, milestones: 0, tasks: 0, logEntries: 0 };
      const plan = await this.planFromProjectTx(tx, workspaceId, source, base, input.withContent, input.withChildren, name, shift);
      const copyId = await this.materializeTx(tx, userId, workspaceId, plan, source.parentId, counts, false);
      return { projectId: copyId, created: counts };
    });
  }

  // --- Материализация ----------------------------------------------------------------------------

  /** Создаёт проект, его вехи/задачи/записи журнала и (рекурсивно) дочерние проекты. */
  private async materializeTx(
    tx: Tx,
    userId: string,
    workspaceId: string,
    node: ProjectPlanNode,
    parentId: string | null,
    counts: ProjectFromTemplateResult["created"],
    rootUsesGivenName: boolean
  ): Promise<string> {
    const name = rootUsesGivenName ? node.name : await this.uniqueProjectNameTx(tx, workspaceId, node.name);
    const project = await tx.project.create({
      data: {
        workspaceId,
        name,
        description: node.description,
        status: node.status,
        color: node.color,
        startAt: node.startAt,
        dueAt: node.dueAt,
        parentId
      }
    });
    counts.projects += 1;

    const milestoneIds: string[] = [];
    for (const [index, milestone] of node.milestones.entries()) {
      const created = await this.milestones.createTx(tx, workspaceId, {
        projectId: project.id,
        title: milestone.title,
        note: milestone.note,
        status: milestone.status,
        startAt: milestone.startAt?.toISOString() ?? null,
        dueAt: milestone.dueAt?.toISOString() ?? null,
        estimatedMinutes: milestone.estimatedMinutes,
        order: index
      });
      milestoneIds.push(created.id);
      counts.milestones += 1;
    }

    for (const task of node.tasks) {
      const created = await this.tasks.createTx(tx, userId, workspaceId, {
        title: task.title,
        description: task.description,
        priority: task.priority,
        projectId: project.id,
        parentId: null,
        milestoneId: task.milestoneIndex === null ? null : milestoneIds[task.milestoneIndex] ?? null,
        startAt: task.startAt?.toISOString() ?? null,
        dueAt: task.dueAt?.toISOString() ?? null,
        estimatedMinutes: task.estimatedMinutes,
        checklist: []
      });
      counts.tasks += 1;
      // `CreateTaskInput` не несёт статус (новая задача всегда открыта), а шаблон может
      // описать задачу «в работе». Статус ставим вторым шагом в той же транзакции.
      if (task.status !== "todo") {
        await this.tasks.updateTx(tx, userId, workspaceId, created.id, { status: task.status });
      }
    }

    for (const entry of node.logEntries) {
      await tx.projectLogEntry.create({
        data: {
          workspaceId,
          projectId: project.id,
          authorId: userId,
          type: entry.type as Prisma.ProjectLogEntryCreateManyInput["type"],
          text: entry.text,
          createdAt: entry.createdAt
        }
      });
      counts.logEntries += 1;
    }

    for (const child of node.children) {
      await this.materializeTx(tx, userId, workspaceId, child, project.id, counts, false);
    }
    return project.id;
  }

  /** Дерево шаблона → дерево с абсолютными датами (сдвиги от стартовой даты). */
  private planFromStructure(node: ProjectTemplateNodeInput, base: Date, rootName: string): ProjectPlanNode {
    return {
      name: rootName,
      description: node.description ?? "",
      status: node.status ?? "active",
      color: node.color ?? null,
      startAt: offsetDate(base, node.startOffsetDays ?? 0),
      dueAt: node.dueOffsetDays === null || node.dueOffsetDays === undefined ? null : offsetDate(base, node.dueOffsetDays),
      milestones: (node.milestones ?? []).map((milestone) => this.planMilestone(milestone, base)),
      tasks: (node.tasks ?? []).map((task) => this.planTask(task, base)),
      logEntries: (node.logEntries ?? []).map((entry) => ({ type: entry.kind, text: entry.text, createdAt: offsetDate(base, entry.dayOffset ?? 0) })),
      children: (node.children ?? []).map((child) => this.planFromStructure(child, base, child.name))
    };
  }

  private planMilestone(milestone: ProjectTemplateMilestone, base: Date) {
    return {
      title: milestone.title,
      note: milestone.note ?? "",
      status: milestone.status ?? "planned",
      startAt: offsetDate(base, milestone.startOffsetDays ?? 0),
      dueAt: milestone.dueOffsetDays === null || milestone.dueOffsetDays === undefined ? null : offsetDate(base, milestone.dueOffsetDays),
      estimatedMinutes: milestone.estimateMinutes ?? null
    };
  }

  private planTask(task: ProjectTemplateTask, base: Date) {
    return {
      title: task.title,
      description: task.description ?? "",
      priority: task.priority ?? "normal",
      status: (task.status ?? "todo") as ProjectPlanNode["tasks"][number]["status"],
      estimatedMinutes: task.estimateMinutes ?? null,
      startAt: offsetDate(base, task.startOffsetDays ?? 0),
      dueAt: task.dueOffsetDays === null || task.dueOffsetDays === undefined ? null : offsetDate(base, task.dueOffsetDays),
      milestoneIndex: task.milestoneIndex ?? null
    };
  }

  /**
   * Проект из БД → план копии. `shift` включается, когда пользователь задал новую
   * стартовую дату: тогда даты пересчитываются от неё, иначе копия сохраняет даты
   * оригинала (копия «рядом», а не «с нуля»).
   */
  private async planFromProjectTx(
    tx: Tx,
    workspaceId: string,
    source: Prisma.ProjectGetPayload<Record<string, never>>,
    base: Date,
    withContent: boolean,
    withChildren: boolean,
    name: string,
    shift: boolean
  ): Promise<ProjectPlanNode> {
    const sourceStart = source.startAt ? startOfUtcDay(source.startAt) : null;
    const dayOffset = (value: Date | null): number | null => {
      if (!value) return null;
      const from = sourceStart ?? base;
      return Math.round((startOfUtcDay(value).getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
    };
    const dateFor = (value: Date | null): Date | null => {
      if (!value) return null;
      if (!shift) return value;
      return offsetDate(base, dayOffset(value) ?? 0);
    };

    // Чужой план читается публичными контрактами владельцев (G4): проекты не трогают
    // таблицы tasks/milestones. Снимок не зависит от выключенности модуля — копия
    // структуры не должна молча терять задачи, если Tasks временно выключен.
    const milestones = await this.milestones.listByProjectTx(tx, workspaceId, source.id);
    const milestoneIndex = new Map(milestones.map((milestone, index) => [milestone.id, index]));
    const tasks = await this.tasks.listByProjectTx(tx, workspaceId, source.id);

    const children: ProjectPlanNode[] = [];
    if (withChildren) {
      const childRows = await tx.project.findMany({ where: { parentId: source.id }, orderBy: [{ name: "asc" }] });
      for (const child of childRows) {
        children.push(await this.planFromProjectTx(tx, workspaceId, child, base, withContent, true, child.name, shift));
      }
    }

    return {
      name,
      description: withContent ? source.description : "",
      status: source.status,
      color: source.color,
      // Даты копии: без новой стартовой даты — те же; с ней — те же сдвиги от новой базы.
      startAt: dateFor(source.startAt),
      dueAt: dateFor(source.dueAt),
      milestones: milestones.map((milestone) => ({
        title: milestone.title,
        note: withContent ? milestone.note : "",
        status: milestone.status as ProjectPlanNode["milestones"][number]["status"],
        startAt: dateFor(milestone.startAt),
        dueAt: dateFor(milestone.dueAt),
        estimatedMinutes: milestone.estimatedMinutes
      })),
      tasks: tasks.map((task) => ({
        title: task.title,
        description: withContent ? task.description : "",
        priority: task.priority as ProjectPlanNode["tasks"][number]["priority"],
        status: task.status as ProjectPlanNode["tasks"][number]["status"],
        estimatedMinutes: task.estimatedMinutes,
        startAt: dateFor(task.startAt),
        dueAt: dateFor(task.dueAt),
        milestoneIndex: task.milestoneId ? milestoneIndex.get(task.milestoneId) ?? null : null
      })),
      // Журнал и комментарии — авторский текст, а не структура: копия их не тиражирует.
      logEntries: [],
      children
    };
  }

  // --- Проверки ----------------------------------------------------------------------------------

  private validatedStructure(value: unknown, message = "Некорректная структура шаблона"): ProjectTemplateStructure {
    const parsed = projectTemplateStructureSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException(message);
    if (projectTemplateDepth(parsed.data) > PROJECT_TREE_MAX_DEPTH) {
      throw new BadRequestException(`Структура шаблона глубже ${PROJECT_TREE_MAX_DEPTH} уровней`);
    }
    this.assertOffsets(parsed.data);
    return parsed.data;
  }

  /** Даты элемента не могут заканчиваться раньше, чем начинаются. */
  private assertOffsets(node: ProjectTemplateNodeInput): void {
    for (const milestone of node.milestones ?? []) {
      if (milestone.dueOffsetDays !== null && milestone.dueOffsetDays < milestone.startOffsetDays) {
        throw new BadRequestException(`Веха «${milestone.title}»: срок раньше начала`);
      }
    }
    for (const task of node.tasks ?? []) {
      if (task.dueOffsetDays !== null && task.dueOffsetDays < task.startOffsetDays) {
        throw new BadRequestException(`Задача «${task.title}»: срок раньше начала`);
      }
      if (task.milestoneIndex !== null && task.milestoneIndex >= (node.milestones ?? []).length) {
        throw new BadRequestException(`Задача «${task.title}» ссылается на несуществующую веху`);
      }
    }
    for (const child of node.children ?? []) this.assertOffsets(child);
  }

  private async assertTemplateTx(tx: Tx, workspaceId: string, templateId: string) {
    const row = await tx.projectTemplate.findUnique({ where: { id: templateId } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Шаблон не найден");
    return row;
  }

  private async assertParentTx(tx: Tx, workspaceId: string, parentId: string): Promise<void> {
    const parent = await tx.project.findFirst({ where: { id: parentId, workspaceId }, select: { id: true } });
    if (!parent) throw new NotFoundException("Родительский проект не найден");
  }

  /** Новый проект глубины `height` под родителем: глубина родителя + height ≤ лимита. */
  private async assertDepthForNewNodeTx(tx: Tx, workspaceId: string, parentId: string, height: number): Promise<void> {
    const chain = await this.hierarchy.chainTx(tx, workspaceId, parentId);
    const parentDepth = chain.length;
    if (parentDepth + height > PROJECT_TREE_MAX_DEPTH) {
      throw new BadRequestException(
        `Дерево проектов глубже ${PROJECT_TREE_MAX_DEPTH} уровней: родитель на уровне ${parentDepth}, структура добавляет ещё ${height}`
      );
    }
  }

  private async projectNameTakenTx(tx: Tx, workspaceId: string, name: string): Promise<boolean> {
    return Boolean(await tx.project.findFirst({ where: { workspaceId, name: { equals: name, mode: "insensitive" } }, select: { id: true } }));
  }

  private async uniqueProjectNameTx(tx: Tx, workspaceId: string, desired: string): Promise<string> {
    if (!(await this.projectNameTakenTx(tx, workspaceId, desired))) return desired;
    for (let index = 2; index <= 100; index++) {
      const candidate = `${desired} (${index})`;
      if (!(await this.projectNameTakenTx(tx, workspaceId, candidate))) return candidate;
    }
    throw new ConflictException("Не удалось подобрать свободное название проекта");
  }
}

function toTemplateDto(row: {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  structure: Prisma.JsonValue;
  createdById: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ProjectTemplate {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    // Структура пишется только через эту проверенную схему, но старые строки могли
    // появиться до неё — отдаём как есть, чтобы шаблон открывался и был поправим.
    structure: row.structure as unknown as ProjectTemplateStructure,
    createdById: row.createdById,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
