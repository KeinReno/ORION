import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Capture as CaptureRow, Prisma } from "@prisma/client";
import {
  effectiveCaptureSeverity,
  type Capture,
  type CaptureAnchorType,
  type CaptureKind,
  type CreateCaptureInput,
  type ListCapturesQuery,
  type UpdateCaptureInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { TasksService } from "../tasks/tasks.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** Where a capture hangs. `null` anchor = a free-floating thought. */
export interface CaptureAnchor {
  type: CaptureAnchorType;
  id: string;
}

type Finder = (tx: Prisma.TransactionClient, id: string) => Promise<{ workspaceId: string } | null>;

/** One lookup per anchor type; every one answers "does this row exist, and in which workspace". */
const ANCHOR_FINDERS: Record<CaptureAnchorType, { label: string; find: Finder }> = {
  project: { label: "Проект", find: (tx, id) => tx.project.findUnique({ where: { id }, select: { workspaceId: true } }) },
  task: { label: "Задача", find: (tx, id) => tx.task.findUnique({ where: { id }, select: { workspaceId: true } }) },
  goal: { label: "Цель", find: (tx, id) => tx.goal.findUnique({ where: { id }, select: { workspaceId: true } }) },
  home: { label: "Дом", find: (tx, id) => tx.home.findUnique({ where: { id }, select: { workspaceId: true } }) },
  account: { label: "Счёт", find: (tx, id) => tx.account.findUnique({ where: { id }, select: { workspaceId: true } }) },
  obligation: { label: "Обязательство", find: (tx, id) => tx.financeObligation.findUnique({ where: { id }, select: { workspaceId: true } }) },
  contact: { label: "Контакт", find: (tx, id) => tx.contact.findUnique({ where: { id }, select: { workspaceId: true } }) }
};

/**
 * Universal captures: an idea / problem / note anchored to any ORION object or to
 * nothing. The thought stays until `promote` creates a real task through
 * TasksService — the capture is never consumed, it just remembers `taskId`.
 *
 * Only the project anchor has a foreign key (`projectId`), so only deleting a
 * project removes its captures. Captures anchored to a home / goal / account…
 * are not cascaded: if the anchor is deleted they stay in the workspace, no
 * longer shown on any host, and are still returned by an unfiltered list.
 */
@Injectable()
export class CapturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TasksService
  ) {}

  async list(userId: string, workspaceId: string, query: ListCapturesQuery): Promise<Capture[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const where: Prisma.CaptureWhereInput = { workspaceId };
      if (query.anchorType === "none") {
        where.anchorType = null;
      } else if (query.anchorType && query.anchorId) {
        await this.assertAnchorTx(tx, workspaceId, { type: query.anchorType, id: query.anchorId });
        where.anchorType = query.anchorType;
        where.anchorId = query.anchorId;
      }
      if (query.kind) where.kind = query.kind;
      if (query.status) where.status = query.status;
      return tx.capture.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateCaptureInput): Promise<Capture> {
    const anchor: CaptureAnchor | null = input.anchorType && input.anchorId ? { type: input.anchorType, id: input.anchorId } : null;
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (anchor) await this.assertAnchorTx(tx, workspaceId, anchor);
      return tx.capture.create({
        data: {
          workspaceId,
          anchorType: anchor?.type ?? null,
          anchorId: anchor?.id ?? null,
          projectId: anchor?.type === "project" ? anchor.id : null,
          kind: input.kind,
          title: input.title,
          body: input.body,
          severity: effectiveCaptureSeverity(input.kind, input.severity)
        }
      });
    });
    return toDto(row);
  }

  async update(userId: string, workspaceId: string, captureId: string, input: UpdateCaptureInput, scope: CaptureScope = {}): Promise<Capture> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.assertOwnedTx(tx, workspaceId, captureId);
      assertScope(current, scope);
      return tx.capture.update({
        where: { id: captureId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(current.kind === "problem" && input.severity !== undefined ? { severity: input.severity } : {})
        }
      });
    });
    return toDto(row);
  }

  async remove(userId: string, workspaceId: string, captureId: string, scope: CaptureScope = {}): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      assertScope(await this.assertOwnedTx(tx, workspaceId, captureId), scope);
      await tx.capture.delete({ where: { id: captureId } });
    });
  }

  /**
   * One task, once; the capture stays. A second click returns the same row. A
   * dismissed thought has to be reopened first, so "не актуально" is not turned
   * into work silently. The task inherits what the anchor can give it: the
   * project, the home, or (for a task anchor) becomes its subtask.
   */
  async promote(userId: string, workspaceId: string, captureId: string, scope: CaptureScope = {}): Promise<Capture> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "tasks");
      // Row lock: parallel "make a task" calls queue up and then see the taskId already set.
      await tx.$queryRaw`SELECT id FROM "captures" WHERE id = ${captureId} FOR UPDATE`;
      const current = await this.assertOwnedTx(tx, workspaceId, captureId);
      assertScope(current, scope);
      if (current.status === "dismissed") throw new BadRequestException("Сначала верните запись из закрытых");
      if (current.taskId) return current;
      const task = await this.tasks.createTx(tx, userId, workspaceId, {
        title: current.title,
        description: current.body,
        priority: "normal",
        ...(current.anchorType === "project" ? { projectId: current.anchorId as string } : {}),
        ...(current.anchorType === "home" ? { homeId: current.anchorId as string } : {}),
        ...(current.anchorType === "task" ? { parentId: current.anchorId as string } : {})
      });
      return tx.capture.update({ where: { id: captureId }, data: { status: "promoted", taskId: task.id } });
    });
    return toDto(row);
  }

  /** The anchor must exist and live in THIS workspace — RLS alone would let a two-workspace user mix them. */
  async assertAnchorTx(tx: Prisma.TransactionClient, workspaceId: string, anchor: CaptureAnchor): Promise<void> {
    const entry = ANCHOR_FINDERS[anchor.type];
    const found = await entry.find(tx, anchor.id);
    if (!found || found.workspaceId !== workspaceId) throw new NotFoundException(`${entry.label} не найден`);
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, captureId: string): Promise<CaptureRow> {
    const row = await tx.capture.findUnique({ where: { id: captureId } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Запись не найдена");
    return row;
  }
}

/**
 * Legacy project routes address a capture as "an idea / problem of THIS project";
 * a capture of another kind or anchor is simply not found there.
 */
export interface CaptureScope {
  kind?: CaptureKind;
  anchor?: CaptureAnchor;
}

function assertScope(row: CaptureRow, scope: CaptureScope): void {
  const wrongKind = scope.kind !== undefined && row.kind !== scope.kind;
  const wrongAnchor = scope.anchor !== undefined && (row.anchorType !== scope.anchor.type || row.anchorId !== scope.anchor.id);
  if (wrongKind || wrongAnchor) {
    throw new NotFoundException(scope.kind === "idea" ? "Идея не найдена" : scope.kind === "problem" ? "Проблема не найдена" : "Запись не найдена");
  }
}

export function toDto(row: CaptureRow): Capture {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    anchorType: row.anchorType as CaptureAnchorType | null,
    anchorId: row.anchorId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    severity: row.severity,
    taskId: row.taskId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
