import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CreateGrantInput, CrossWorkspaceGrant, SharedGrantIssued, SharedGrantObjectType, SharedGrantSummary } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * U09 (docs/SONNET_IMPLEMENTATION/27-U09-THREAT-MODEL.md) — lifecycle of a
 * `CrossWorkspaceGrant` record itself (create/revoke/list-mine). This is
 * NOT where the grant-aware object read happens — that's `SharedService`,
 * which is the only caller of `PrismaService.withGrant`. Everything here
 * runs through the ordinary `withUser` transaction, because the grant
 * *record* (not the object it points at) is visible under the additive
 * `cross_workspace_grants_isolation` policy to both the source workspace's
 * members (for management) and the grantee (for listing), with no special
 * GUC required.
 */
@Injectable()
export class SharedGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * Раздел 4 «Create», раздел 5 вопрос 1 (финализировано): только `owner`
   * пространства-источника. `objectType`/`objectId` проверяются на
   * реальную принадлежность workspaceId — иначе владелец мог бы случайно
   * (или намеренно) выдать грант на чужой объект, угадав id.
   */
  async create(userId: string, workspaceId: string, input: CreateGrantInput): Promise<CrossWorkspaceGrant> {
    const grant = await this.prisma.withUser(userId, async (tx) => {
      const membership = await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      await assertObjectOwnedByWorkspace(tx, input.objectType, input.objectId, workspaceId);

      const grantee = await tx.user.findUnique({ where: { id: input.granteeUserId } });
      if (!grantee) throw new NotFoundException("Пользователь-получатель не найден");

      const expiresAt =
        input.duration.kind === "none"
          ? null
          : input.duration.kind === "7d"
            ? new Date(Date.now() + SEVEN_DAYS_MS)
            : new Date(input.duration.expiresAt);
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException("Некорректная дата истечения гранта");
      }

      return tx.crossWorkspaceGrant.create({
        data: {
          workspaceId,
          granterId: membership.id,
          granteeUserId: input.granteeUserId,
          objectType: input.objectType,
          objectId: input.objectId,
          scope: "full",
          expiresAt
        }
      });
    });
    return toDto(grant);
  }

  /**
   * Раздел 4 «Revoke», раздел 5 вопрос 2 (финализировано): granterId (если
   * он всё ещё member) ИЛИ текущий owner пространства-источника — grantee
   * никогда. `assertMemberTx` alone would let any member revoke someone
   * else's grant, so this checks explicitly instead of delegating to a role
   * gate that doesn't match this exact "granter OR owner" rule.
   */
  async revoke(userId: string, workspaceId: string, grantId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const grant = await tx.crossWorkspaceGrant.findUnique({ where: { id: grantId } });
      if (!grant || grant.workspaceId !== workspaceId) throw new NotFoundException("Грант не найден");

      const membership = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
      const isOwner = membership?.role === "owner";
      const isGranter = membership?.id === grant.granterId;
      if (!isOwner && !isGranter) {
        throw new ForbiddenException("Только владелец пространства или выдавший грант может его отозвать");
      }
      if (grant.revokedAt) return; // already revoked — idempotent
      await tx.crossWorkspaceGrant.update({
        where: { id: grantId },
        data: { revokedAt: new Date(), revokedByUserId: userId }
      });
    });
  }

  /** `GET /shared` — active grants where the caller is the grantee, newest first. */
  async listMine(userId: string): Promise<SharedGrantSummary[]> {
    const grants = await this.prisma.withUser(userId, (tx) =>
      tx.crossWorkspaceGrant.findMany({
        where: {
          granteeUserId: userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        orderBy: { createdAt: "desc" }
      })
    );
    // Source workspaces are never ones this user is a member of — the
    // ordinary `workspaces_isolation` (membership-based) RLS policy would
    // hide every one of them from a ordinary `withUser` read. Resolving
    // just the display name by id, under `asSystem`, is a narrow, audited
    // exception: it leaks only a name, the minimum "источник" needs (раздел
    // 6) — same shape of bypass `WorkspacesService.createForUser` already
    // uses for its own chicken-and-egg case.
    const ids = [...new Set(grants.map((g) => g.workspaceId))];
    const workspaces = ids.length > 0 ? await this.prisma.asSystem((tx) => tx.workspace.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) : [];
    const workspaceNames = new Map(workspaces.map((w) => [w.id, w.name]));
    return grants.map((g) => ({
      grantId: g.id,
      objectType: g.objectType as SharedGrantObjectType,
      sourceWorkspaceId: g.workspaceId,
      sourceWorkspaceName: workspaceNames.get(g.workspaceId) ?? "",
      expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
      createdAt: g.createdAt.toISOString()
    }));
  }

  /**
   * `GET workspaces/:id/grants` — every grant issued FROM this workspace
   * (any state, so a revoked one still shows in the owner's list rather than
   * vanishing). Owner-only, same gate `create()` requires — a plain member
   * has no "Управление внешним доступом" delegation in this slice (раздел 4).
   */
  async listForWorkspace(userId: string, workspaceId: string): Promise<SharedGrantIssued[]> {
    const grants = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      return tx.crossWorkspaceGrant.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
    });
    const ids = [...new Set(grants.map((g) => g.granteeUserId))];
    // Narrow, audited display-name lookup — same precedent as listMine's
    // workspace-name resolution: the grantee is never a member of this
    // workspace, so an ordinary withUser read wouldn't see them either.
    const users =
      ids.length > 0
        ? await this.prisma.asSystem((tx) => tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }))
        : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return grants.map((g) => ({
      grantId: g.id,
      objectType: g.objectType as SharedGrantObjectType,
      objectId: g.objectId,
      granteeUserId: g.granteeUserId,
      granteeName: byId.get(g.granteeUserId)?.name ?? "—",
      granteeEmail: byId.get(g.granteeUserId)?.email ?? null,
      expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
      createdAt: g.createdAt.toISOString(),
      revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null
    }));
  }
}

/** Mirrors entity-registry.ts's "owned" check, restricted to the four grant-eligible types. */
async function assertObjectOwnedByWorkspace(
  tx: Prisma.TransactionClient,
  objectType: SharedGrantObjectType,
  objectId: string,
  workspaceId: string
): Promise<void> {
  let owned: boolean;
  switch (objectType) {
    case "note": {
      // R29-03: can't issue a fresh grant on an object already in the
      // trash — same "deleted = not there" contract as the read side below.
      const row = await tx.note.findUnique({ where: { id: objectId }, select: { workspaceId: true, deletedAt: true } });
      owned = !!row && row.workspaceId === workspaceId && row.deletedAt === null;
      break;
    }
    case "document": {
      const row = await tx.document.findUnique({ where: { id: objectId }, select: { workspaceId: true, deletedAt: true, kind: true } });
      owned = !!row && row.workspaceId === workspaceId && row.deletedAt === null && row.kind === "file";
      break;
    }
    case "project": {
      const row = await tx.project.findUnique({ where: { id: objectId }, select: { workspaceId: true } });
      owned = row?.workspaceId === workspaceId;
      break;
    }
    case "transaction": {
      const row = await tx.transaction.findUnique({ where: { id: objectId }, select: { workspaceId: true } });
      owned = row?.workspaceId === workspaceId;
      break;
    }
  }
  if (!owned) throw new NotFoundException("Объект не найден в этом пространстве");
}

function toDto(g: {
  id: string;
  workspaceId: string;
  granterId: string;
  granteeUserId: string;
  objectType: string;
  scope: string;
  objectId: string;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}): CrossWorkspaceGrant {
  return {
    id: g.id,
    workspaceId: g.workspaceId,
    granterId: g.granterId,
    granteeUserId: g.granteeUserId,
    objectType: g.objectType as SharedGrantObjectType,
    objectId: g.objectId,
    scope: g.scope as "full" | "projection",
    expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
    createdAt: g.createdAt.toISOString(),
    revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null
  };
}
