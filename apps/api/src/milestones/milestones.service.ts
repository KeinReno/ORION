import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  CreateMilestoneInput,
  Milestone,
  MilestoneCascadeImpact,
  MilestoneReschedulePreviewInput,
  UpdateMilestoneInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

const milestoneInclude = {
  dependsOn: { include: { dependsOn: { select: { status: true } } } }
} satisfies Prisma.MilestoneInclude;
type MilestoneModel = Prisma.MilestoneGetPayload<{ include: typeof milestoneInclude }>;

/**
 * ORION v0.27 «План проекта» — milestones, the second Gantt level. Mirrors
 * `TasksService`'s dependency machinery (cycle check, `blocked` derivation)
 * one level up, plus the piece tasks don't need: `cascadeReschedule`, the
 * finish-to-start auto-schedule a Gantt drag-resize relies on.
 */
@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string, projectId?: string): Promise<Milestone[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.milestone.findMany({
        where: { workspaceId, ...(projectId ? { projectId } : {}) },
        include: milestoneInclude,
        orderBy: [{ order: "asc" }, { startAt: "asc" }, { createdAt: "asc" }]
      });
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateMilestoneInput): Promise<Milestone> {
    const milestone = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, input.projectId);
      const dependencyIds = unique(input.dependencyIds ?? []);
      await this.assertDependenciesTx(tx, workspaceId, null, dependencyIds);
      const created = await tx.milestone.create({
        data: {
          workspaceId,
          projectId: input.projectId,
          title: input.title,
          note: input.note,
          status: input.status,
          startAt: input.startAt ?? null,
          dueAt: input.dueAt ?? null,
          estimatedMinutes: input.estimatedMinutes ?? null,
          order: input.order
        }
      });
      if (dependencyIds.length) {
        await tx.milestoneDependency.createMany({
          data: dependencyIds.map((dependsOnMilestoneId) => ({ workspaceId, milestoneId: created.id, dependsOnMilestoneId }))
        });
      }
      return tx.milestone.findUniqueOrThrow({ where: { id: created.id }, include: milestoneInclude });
    });
    return toDto(milestone);
  }

  async update(userId: string, workspaceId: string, milestoneId: string, input: UpdateMilestoneInput): Promise<Milestone> {
    const milestone = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, milestoneId);
      const data: Prisma.MilestoneUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.note !== undefined) data.note = input.note;
      if (input.status !== undefined) data.status = input.status;
      if (input.estimatedMinutes !== undefined) data.estimatedMinutes = input.estimatedMinutes;
      if (input.order !== undefined) data.order = input.order;

      const datesChanged = input.startAt !== undefined || input.dueAt !== undefined;
      if (input.startAt !== undefined) data.startAt = input.startAt;
      if (input.dueAt !== undefined) data.dueAt = input.dueAt;
      await tx.milestone.update({ where: { id: milestoneId }, data });

      if (input.dependencyIds !== undefined) {
        const dependencyIds = unique(input.dependencyIds);
        await this.assertDependenciesTx(tx, workspaceId, milestoneId, dependencyIds);
        await tx.milestoneDependency.deleteMany({ where: { milestoneId } });
        if (dependencyIds.length) {
          await tx.milestoneDependency.createMany({
            data: dependencyIds.map((dependsOnMilestoneId) => ({ workspaceId, milestoneId, dependsOnMilestoneId }))
          });
        }
      }

      if (datesChanged) await cascadeRescheduleTx(tx, milestoneId);

      return tx.milestone.findUniqueOrThrow({ where: { id: milestoneId }, include: milestoneInclude });
    });
    return toDto(milestone);
  }

  /**
   * S14a — cascade preview. Read-only: simulates the same finish-to-start
   * walk `cascadeRescheduleTx` performs on commit, but against a
   * hypothetical startAt/dueAt for `milestoneId` that is never written, so
   * the Gantt can show "will also move: …" and let the user confirm before
   * the real PATCH applies it. Milestones the simulation doesn't touch are
   * left out of the result — an empty array means "safe to apply silently,
   * nothing else moves".
   */
  async previewReschedule(
    userId: string,
    workspaceId: string,
    milestoneId: string,
    input: MilestoneReschedulePreviewInput
  ): Promise<MilestoneCascadeImpact[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, milestoneId);
      const overrideStart = input.startAt ? new Date(input.startAt) : null;
      const overrideDue = input.dueAt ? new Date(input.dueAt) : null;
      const changed = await simulateCascade(tx, milestoneId, overrideStart, overrideDue);
      const ids = [...changed.keys()];
      if (ids.length === 0) return [];
      const previousRows = await tx.milestone.findMany({ where: { id: { in: ids } } });
      const previousById = new Map(previousRows.map((row) => [row.id, row]));
      return ids.map((id) => {
        const next = changed.get(id);
        if (!next) throw new Error("unreachable: id came from changed.keys()");
        const prev = previousById.get(id);
        return {
          milestoneId: id,
          title: next.title,
          previousStartAt: prev?.startAt?.toISOString() ?? null,
          previousDueAt: prev?.dueAt?.toISOString() ?? null,
          nextStartAt: next.startAt?.toISOString() ?? null,
          nextDueAt: next.dueAt?.toISOString() ?? null
        };
      });
    });
  }

  async remove(userId: string, workspaceId: string, milestoneId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, milestoneId);
      // Tasks grouped under this milestone keep their own dates — losing the
      // phase they belonged to doesn't erase what was already planned on them.
      await tx.milestone.delete({ where: { id: milestoneId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, milestoneId: string): Promise<MilestoneModel> {
    const milestone = await tx.milestone.findUnique({ where: { id: milestoneId }, include: milestoneInclude });
    if (!milestone || milestone.workspaceId !== workspaceId) throw new NotFoundException("Веха не найдена");
    return milestone;
  }

  private async assertProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<void> {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
  }

  private async assertDependenciesTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    milestoneId: string | null,
    ids: string[]
  ): Promise<void> {
    if (milestoneId && ids.includes(milestoneId)) throw new BadRequestException("Веха не может зависеть от самой себя");
    const found = await tx.milestone.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true } });
    if (found.length !== ids.length) throw new NotFoundException("Одна из зависимостей не найдена");
    if (!milestoneId) return;
    for (const dependencyId of ids) {
      const reachesCurrent = await dependsOn(tx, dependencyId, milestoneId);
      if (reachesCurrent) throw new BadRequestException("Нельзя создать циклическую зависимость вех");
    }
  }
}

async function dependsOn(tx: Prisma.TransactionClient, fromId: string, targetId: string): Promise<boolean> {
  const visited = new Set<string>();
  let frontier = [fromId];
  while (frontier.length) {
    if (frontier.includes(targetId)) return true;
    const next = await tx.milestoneDependency.findMany({ where: { milestoneId: { in: frontier } }, select: { dependsOnMilestoneId: true } });
    frontier = next.map((item) => item.dependsOnMilestoneId).filter((id) => !visited.has(id));
    frontier.forEach((id) => visited.add(id));
  }
  return false;
}

/**
 * After milestone `milestoneId`'s dates changed, push forward any direct or
 * transitive dependent whose `startAt` now precedes its predecessors'
 * `dueAt` — finish-to-start auto-schedule, one direction only. Never pulls a
 * dependent *earlier* just because a predecessor moved earlier: that could
 * silently violate a different constraint the user set on purpose, so ORION
 * only ever resolves a conflict it just created, not ones that might
 * already exist. Delegates the actual walk to `simulateCascade` (also used
 * read-only by `previewReschedule`) so preview and apply can never disagree,
 * then persists whatever it computed.
 */
async function cascadeRescheduleTx(tx: Prisma.TransactionClient, milestoneId: string): Promise<void> {
  const self = await tx.milestone.findUniqueOrThrow({ where: { id: milestoneId } });
  const changed = await simulateCascade(tx, milestoneId, self.startAt, self.dueAt);
  for (const [id, value] of changed) {
    await tx.milestone.update({ where: { id }, data: { startAt: value.startAt, dueAt: value.dueAt } });
  }
}

/**
 * Pure read-only simulation of the finish-to-start cascade, given a
 * *hypothetical* startAt/dueAt for `milestoneId` (which may not yet be
 * written to the DB — that's the whole point for `previewReschedule`).
 * Walks the dependency graph exactly like the old in-place version did, but
 * keeps every candidate value it would have written in `current` instead of
 * issuing an UPDATE, so a predecessor whose own date it just "moved" earlier
 * in the same walk is used by later ancestors too. Returns only the
 * dependents that actually changed (never includes `milestoneId` itself —
 * that one is what the caller is proposing, not something the cascade
 * decided on its own).
 */
async function simulateCascade(
  tx: Prisma.TransactionClient,
  milestoneId: string,
  overrideStart: Date | null,
  overrideDue: Date | null
): Promise<Map<string, { title: string; startAt: Date | null; dueAt: Date | null }>> {
  const self = await tx.milestone.findUniqueOrThrow({ where: { id: milestoneId }, select: { title: true } });
  const current = new Map<string, { title: string; startAt: Date | null; dueAt: Date | null }>();
  current.set(milestoneId, { title: self.title, startAt: overrideStart, dueAt: overrideDue });
  const changed = new Map<string, { title: string; startAt: Date | null; dueAt: Date | null }>();

  const visited = new Set<string>([milestoneId]);
  let frontier = [milestoneId];
  while (frontier.length) {
    const edges = await tx.milestoneDependency.findMany({
      where: { dependsOnMilestoneId: { in: frontier } },
      select: { milestoneId: true }
    });
    const candidateIds = [...new Set(edges.map((edge) => edge.milestoneId))].filter((id) => !visited.has(id));
    if (!candidateIds.length) break;
    candidateIds.forEach((id) => visited.add(id));

    const nextFrontier: string[] = [];
    for (const dependentId of candidateIds) {
      const dependentRow = await tx.milestone.findUniqueOrThrow({ where: { id: dependentId } });
      const predecessorRows = await tx.milestoneDependency.findMany({
        where: { milestoneId: dependentId },
        include: { dependsOn: { select: { id: true, dueAt: true } } }
      });
      const requiredStart = predecessorRows.reduce<Date | null>((max, row) => {
        // A predecessor already re-scheduled earlier in *this* walk wins
        // over its stale on-disk `dueAt` — that's the value it would
        // actually have once the cascade finishes.
        const finish = current.get(row.dependsOn.id)?.dueAt ?? row.dependsOn.dueAt;
        return finish && (!max || finish > max) ? finish : max;
      }, null);
      const dependent = current.get(dependentId) ?? { title: dependentRow.title, startAt: dependentRow.startAt, dueAt: dependentRow.dueAt };
      if (!requiredStart || (dependent.startAt && dependent.startAt >= requiredStart)) {
        current.set(dependentId, dependent);
        continue;
      }

      const duration = dependent.startAt && dependent.dueAt ? dependent.dueAt.getTime() - dependent.startAt.getTime() : null;
      const newStart = requiredStart;
      const newDue = duration !== null ? new Date(newStart.getTime() + duration) : dependent.dueAt && dependent.dueAt > newStart ? dependent.dueAt : newStart;
      const updated = { title: dependentRow.title, startAt: newStart, dueAt: newDue };
      current.set(dependentId, updated);
      changed.set(dependentId, updated);
      nextFrontier.push(dependentId);
    }
    frontier = nextFrontier;
  }
  return changed;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function toDto(milestone: MilestoneModel): Milestone {
  const dependencyIds = milestone.dependsOn.map((dependency) => dependency.dependsOnMilestoneId);
  return {
    id: milestone.id,
    workspaceId: milestone.workspaceId,
    projectId: milestone.projectId,
    title: milestone.title,
    note: milestone.note,
    status: milestone.status,
    startAt: milestone.startAt?.toISOString() ?? null,
    dueAt: milestone.dueAt?.toISOString() ?? null,
    estimatedMinutes: milestone.estimatedMinutes,
    order: milestone.order,
    dependencyIds,
    blocked: milestone.dependsOn.some((dependency) => dependency.dependsOn.status !== "done"),
    createdAt: milestone.createdAt.toISOString(),
    updatedAt: milestone.updatedAt.toISOString()
  };
}
