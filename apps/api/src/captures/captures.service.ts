import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Capture as CaptureRow, Prisma } from "@prisma/client";
import {
  effectiveCaptureSeverity,
  type Capture,
  type CaptureAnchorType,
  type CreateCaptureInput,
  type ListCapturesQuery,
  type OrionModuleId,
  type UpdateCaptureInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { TaskOperations } from "../tasks/public/task-operations";
import { WorkspacesService } from "../workspaces/workspaces.service";

import type { CaptureAnchor, CaptureScope } from "./public/capture-operations";
export type { CaptureAnchor, CaptureScope } from "./public/capture-operations";
import { ProjectReferences } from "../projects/public/project-references";
import { TaskIntegrationReader } from "../tasks/public/task-integration-reader";
import { GoalReferences } from "../goals/public/goal-references";
import { HomeReferences } from "../home/public/home-references";
import { FinanceAnchorReferences } from "../finance/public/finance-anchor-references";
import { ContactReferences } from "../contacts/public/contact-references";

const ANCHOR_LABELS: Record<CaptureAnchorType, string> = {
  project: "Проект", task: "Задача", goal: "Цель", home: "Дом", account: "Счёт", obligation: "Обязательство", contact: "Контакт"
};

/** The module a host object belongs to — a capture cannot hang on an object whose module is off. */
const ANCHOR_MODULE: Partial<Record<CaptureAnchorType, OrionModuleId>> = {
  project: "projects",
  task: "tasks",
  goal: "projects",
  home: "home",
  account: "finance",
  obligation: "finance",
  contact: "contacts"
};

/**
 * Universal captures: an idea / problem / note anchored to any ORION object or to
 * nothing. The thought stays until `promote` creates a real task through
 * TasksService — the capture is never consumed, it just remembers `taskId`.
 *
 * Deleting the anchor deletes its captures: a real FK for projects (`projectId`), a database
 * trigger for the other anchor types (migration 20261015100000_capture_anchor_cleanup).
 */
@Injectable()
export class CapturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TaskOperations,
    private readonly projects: ProjectReferences,
    private readonly taskReferences: TaskIntegrationReader,
    private readonly goals: GoalReferences,
    private readonly homes: HomeReferences,
    private readonly financeReferences: FinanceAnchorReferences,
    private readonly contacts: ContactReferences
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
      if (anchor) {
        await this.assertAnchorTx(tx, workspaceId, anchor);
        await this.assertAnchorModuleTx(tx, userId, workspaceId, anchor);
      }
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
      // Re-anchoring is a plain-API feature: the legacy per-project routes address a capture BY its anchor.
      const reanchor = scope.anchor === undefined && input.anchorType !== undefined;
      if (reanchor && input.anchorType && input.anchorId) {
        const anchor = { type: input.anchorType, id: input.anchorId };
        await this.assertAnchorTx(tx, workspaceId, anchor);
        await this.assertAnchorModuleTx(tx, userId, workspaceId, anchor);
      }
      return tx.capture.update({
        where: { id: captureId },
        data: {
          ...(reanchor
            ? {
                anchorType: input.anchorType ?? null,
                anchorId: input.anchorId ?? null,
                projectId: input.anchorType === "project" ? (input.anchorId as string) : null
              }
            : {}),
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
        checklist: [],
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
    const exists = await this.anchorExistsTx(tx, workspaceId, anchor);
    if (!exists) throw new NotFoundException(`${ANCHOR_LABELS[anchor.type]} не найден`);
  }

  private async anchorExistsTx(tx: Prisma.TransactionClient, workspaceId: string, anchor: CaptureAnchor): Promise<boolean> {
    switch (anchor.type) {
      case "project": return this.projects.existsTx(tx, workspaceId, anchor.id);
      case "task": return !!await this.taskReferences.referenceTx(tx, workspaceId, anchor.id);
      case "goal": return this.goals.existsTx(tx, workspaceId, anchor.id);
      case "home": return this.homes.existsTx(tx, workspaceId, anchor.id);
      case "account": return this.financeReferences.accountTx(tx, workspaceId, anchor.id);
      case "obligation": return this.financeReferences.obligationTx(tx, workspaceId, anchor.id);
      case "contact": return this.contacts.existsTx(tx, workspaceId, anchor.id);
    }
  }

  private async assertAnchorModuleTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, anchor: CaptureAnchor): Promise<void> {
    const moduleId = ANCHOR_MODULE[anchor.type];
    if (moduleId) await this.modules.assertEnabledTx(tx, userId, workspaceId, moduleId);
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, captureId: string): Promise<CaptureRow> {
    const row = await tx.capture.findUnique({ where: { id: captureId } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Запись не найдена");
    return row;
  }
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
