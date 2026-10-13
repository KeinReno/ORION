import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Goal as GoalRow, GoalPlan as PlanRow, Prisma } from "@prisma/client";
import {
  goalProgress,
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
      return tx.goal.create({
        data: { workspaceId, title: input.title, description: input.description, dueAt: input.dueAt ?? null },
        include: { plans: true }
      });
    });
    return (await this.toDtos(userId, workspaceId, [row]))[0];
  }

  async update(userId: string, workspaceId: string, goalId: string, input: UpdateGoalInput): Promise<Goal> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertGoalTx(tx, workspaceId, goalId);
      return tx.goal.update({
        where: { id: goalId },
        data: {
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

    return rows.map((row) => {
      const plans = row.plans
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
      const { progress, unknown } = goalProgress(plans);
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.title,
        description: row.description,
        status: goalStatusSchema.catch("active").parse(row.status),
        dueAt: row.dueAt?.toISOString() ?? null,
        plans,
        progress,
        unknownPlans: unknown,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }
}
