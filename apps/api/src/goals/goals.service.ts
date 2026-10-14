import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Goal as GoalRow, GoalPlan as PlanRow, Prisma } from "@prisma/client";
import {
  GOAL_MAX_DEPTH,
  checkGoalParent,
  goalProgress,
  goalTreeProgress,
  goalStatusSchema,
  type AddGoalPlanInput,
  type CreateGoalInput,
  type Goal,
  type UpdateGoalInput,
  type UpdateGoalPlanInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

type GoalWithPlans = GoalRow & { plans: PlanRow[] };

/**
 * Global goals over projects. Progress is never stored: it is derived from the linked
 * projects' own task progress every time (`goalProgress` in shared-types), so there is
 * no number that can go stale or be edited by hand.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly projects: ProjectsService
  ) {}

  async list(userId: string, workspaceId: string): Promise<Goal[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.goal.findMany({ where: { workspaceId }, include: { plans: true }, orderBy: [{ createdAt: "desc" }] });
    });
    return this.toDtos(userId, workspaceId, rows);
  }

  async create(userId: string, workspaceId: string, input: CreateGoalInput): Promise<Goal> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const parentId = input.parentId ?? null;
      if (parentId) await this.assertParentTx(tx, workspaceId, null, parentId);
      return tx.goal.create({
        data: {
          workspaceId,
          title: input.title,
          description: input.description,
          dueAt: input.dueAt ?? null,
          parentId,
          subWeight: input.subWeight
        },
        include: { plans: true }
      });
    });
    return (await this.toDtos(userId, workspaceId, [row]))[0];
  }

  async update(userId: string, workspaceId: string, goalId: string, input: UpdateGoalInput): Promise<Goal> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertGoalTx(tx, workspaceId, goalId);
      if (input.parentId) await this.assertParentTx(tx, workspaceId, goalId, input.parentId);
      return tx.goal.update({
        where: { id: goalId },
        data: {
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.subWeight !== undefined ? { subWeight: input.subWeight } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {})
        },
        include: { plans: true }
      });
    });
    return (await this.toDtos(userId, workspaceId, [row]))[0];
  }

  async remove(userId: string, workspaceId: string, goalId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertGoalTx(tx, workspaceId, goalId);
      await tx.goal.delete({ where: { id: goalId } });
    });
  }

  async addPlan(userId: string, workspaceId: string, goalId: string, input: AddGoalPlanInput): Promise<Goal> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertGoalTx(tx, workspaceId, goalId);
      // The project must be in THIS workspace: a member of two spaces sees both, RLS would not stop a mix-up.
      const project = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
      const existing = await tx.goalPlan.findUnique({ where: { goalId_projectId: { goalId, projectId: input.projectId } } });
      if (existing) throw new ConflictException("Этот проект уже входит в цель");
      await tx.goalPlan.create({ data: { workspaceId, goalId, projectId: input.projectId, weight: input.weight } });
      return tx.goal.findUniqueOrThrow({ where: { id: goalId }, include: { plans: true } });
    });
    return (await this.toDtos(userId, workspaceId, [row]))[0];
  }

  async updatePlan(userId: string, workspaceId: string, goalId: string, planId: string, input: UpdateGoalPlanInput): Promise<Goal> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPlanTx(tx, workspaceId, goalId, planId);
      await tx.goalPlan.update({ where: { id: planId }, data: { weight: input.weight } });
      return tx.goal.findUniqueOrThrow({ where: { id: goalId }, include: { plans: true } });
    });
    return (await this.toDtos(userId, workspaceId, [row]))[0];
  }

  async removePlan(userId: string, workspaceId: string, goalId: string, planId: string): Promise<Goal> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertPlanTx(tx, workspaceId, goalId, planId);
      await tx.goalPlan.delete({ where: { id: planId } });
      return tx.goal.findUniqueOrThrow({ where: { id: goalId }, include: { plans: true } });
    });
    return (await this.toDtos(userId, workspaceId, [row]))[0];
  }

  private async assertGoalTx(tx: Prisma.TransactionClient, workspaceId: string, goalId: string): Promise<GoalRow> {
    const goal = await tx.goal.findUnique({ where: { id: goalId } });
    if (!goal || goal.workspaceId !== workspaceId) throw new NotFoundException("Цель не найдена");
    return goal;
  }

  /**
   * Parent must be a goal of THIS workspace, not the goal itself or its descendant, and the
   * resulting depth must stay within GOAL_MAX_DEPTH. The workspace's goal rows are locked first
   * so two concurrent moves cannot each look valid and together close a cycle.
   */
  private async assertParentTx(tx: Prisma.TransactionClient, workspaceId: string, goalId: string | null, parentId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "goals" WHERE "workspaceId" = ${workspaceId} FOR UPDATE`;
    const nodes = await tx.goal.findMany({ where: { workspaceId }, select: { id: true, parentId: true } });
    const check = checkGoalParent(goalId, parentId, nodes);
    if (check.ok) return;
    if (check.reason === "missing") throw new NotFoundException("Родительская цель не найдена");
    if (check.reason === "depth") throw new BadRequestException(`Вложенность целей ограничена ${GOAL_MAX_DEPTH} уровнями`);
    throw new BadRequestException("Цель не может быть вложена в саму себя или в свою подцель");
  }

  private async assertPlanTx(tx: Prisma.TransactionClient, workspaceId: string, goalId: string, planId: string): Promise<void> {
    const plan = await tx.goalPlan.findUnique({ where: { id: planId } });
    if (!plan || plan.workspaceId !== workspaceId || plan.goalId !== goalId) throw new NotFoundException("План не найден");
  }

  private async toDtos(userId: string, workspaceId: string, rows: GoalWithPlans[]): Promise<Goal[]> {
    if (rows.length === 0) return [];
    // Progress comes from the project DTO (the one definition of "how done is a project").
    const [live, archived] = await Promise.all([
      this.projects.list(userId, workspaceId, false),
      this.projects.list(userId, workspaceId, true)
    ]);
    const byId = new Map<string, { p: (typeof live)[number]; archived: boolean }>();
    for (const p of live) byId.set(p.id, { p, archived: false });
    for (const p of archived) byId.set(p.id, { p, archived: true });

    // Sub-goals feed their parent, so progress is computed over the whole workspace tree.
    const all = await this.prisma.withUser(userId, (tx) => tx.goal.findMany({ where: { workspaceId }, include: { plans: true } }));
    const buildPlans = (row: GoalWithPlans) =>
      row.plans
        .map((plan) => {
          const entry = byId.get(plan.projectId);
          if (!entry) return null;
          const tasks = entry.p.counts.tasks;
          return {
            id: plan.id,
            projectId: plan.projectId,
            projectName: entry.p.name,
            projectArchived: entry.archived,
            weight: plan.weight,
            progress: tasks === 0 ? null : entry.p.progress,
            tasks,
            closed: entry.p.counts.closed
          };
        })
        .filter((plan): plan is NonNullable<typeof plan> => plan !== null)
        .sort((a, b) => a.projectName.localeCompare(b.projectName, "ru"));
    const planMap = new Map(all.map((g) => [g.id, buildPlans(g)]));
    const tree = goalTreeProgress(all.map((g) => ({ id: g.id, parentId: g.parentId, subWeight: g.subWeight, plans: planMap.get(g.id) ?? [] })));
    const subCounts = new Map<string, number>();
    for (const g of all) if (g.parentId) subCounts.set(g.parentId, (subCounts.get(g.parentId) ?? 0) + 1);

    return rows.map((row) => {
      const plans = planMap.get(row.id) ?? buildPlans(row);
      const own = tree.get(row.id) ?? { progress: goalProgress(plans).progress, unknownPlans: 0, unknownSubGoals: 0 };
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.title,
        description: row.description,
        status: goalStatusSchema.catch("active").parse(row.status),
        dueAt: row.dueAt?.toISOString() ?? null,
        parentId: row.parentId,
        subWeight: row.subWeight,
        subGoalCount: subCounts.get(row.id) ?? 0,
        plans,
        progress: own.progress,
        unknownPlans: own.unknownPlans,
        unknownSubGoals: own.unknownSubGoals,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }
}
