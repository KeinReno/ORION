import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  isModuleEnabled,
  isModuleRestricted,
  isOrionModuleId,
  MODULE_CATALOG,
  moduleStates,
  type ModuleManifest,
  type OrionModuleId,
  type WorkspaceModuleState
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  catalog(): readonly ModuleManifest[] {
    return MODULE_CATALOG;
  }

  async list(userId: string, workspaceId: string): Promise<WorkspaceModuleState[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const { disabled, restricted } = await this.overridesTx(tx, workspaceId);
      return moduleStates(disabled, restricted);
    });
  }

  async setEnabled(
    userId: string,
    workspaceId: string,
    moduleId: string,
    enabled: boolean
  ): Promise<WorkspaceModuleState[]> {
    if (!isOrionModuleId(moduleId)) throw new NotFoundException("Модуль не найден");
    const manifest = MODULE_CATALOG.find((item) => item.id === moduleId);
    if (!manifest) throw new NotFoundException("Модуль не найден");
    if (manifest.required && !enabled) {
      throw new BadRequestException(`Модуль «${manifest.label}» нельзя выключить`);
    }

    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } }
      });
      if (membership?.role !== "owner") {
        throw new ForbiddenException("Только владелец может менять состав модулей");
      }

      const { disabled, restricted } = await this.overridesTx(tx, workspaceId);
      const current = new Set(disabled);
      if (enabled) current.delete(moduleId);
      else current.add(moduleId);

      await tx.workspace.update({
        where: { id: workspaceId },
        data: { disabledModules: [...current] }
      });
      return moduleStates([...current], restricted);
    });
  }

  /**
   * Visibility, not availability: a restricted module stays on for
   * `owner`/`lead`, only `member` is turned away (see `assertEnabledTx`).
   * Owner-only to flip, same gate as `setEnabled`.
   */
  async setRestricted(
    userId: string,
    workspaceId: string,
    moduleId: string,
    restricted: boolean
  ): Promise<WorkspaceModuleState[]> {
    if (!isOrionModuleId(moduleId)) throw new NotFoundException("Модуль не найден");
    const manifest = MODULE_CATALOG.find((item) => item.id === moduleId);
    if (!manifest) throw new NotFoundException("Модуль не найден");

    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } }
      });
      if (membership?.role !== "owner") {
        throw new ForbiddenException("Только владелец может ограничивать доступ к модулям");
      }

      const { disabled, restricted: current } = await this.overridesTx(tx, workspaceId);
      const next = new Set(current);
      if (restricted) next.add(moduleId);
      else next.delete(moduleId);

      await tx.workspace.update({
        where: { id: workspaceId },
        data: { restrictedModules: [...next] }
      });
      return moduleStates(disabled, [...next]);
    });
  }

  async assertEnabled(userId: string, workspaceId: string, moduleId: OrionModuleId): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertEnabledTx(tx, userId, workspaceId, moduleId);
    });
  }

  /**
   * The single checkpoint every module-gated path runs through — the
   * `@RequireModule` guard, plugins (via `extendsModuleId`), inbox
   * processing into another module, note attachments into documents. Checks
   * disabled first (409, applies to everyone), then restricted (403, `member`
   * only — `owner`/`lead` pass straight through).
   */
  async assertEnabledTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    moduleId: OrionModuleId
  ): Promise<void> {
    const { disabled, restricted } = await this.overridesTx(tx, workspaceId);
    const label = MODULE_CATALOG.find((item) => item.id === moduleId)?.label ?? moduleId;
    if (!isModuleEnabled(disabled, moduleId)) {
      throw new ConflictException(`Модуль «${label}» выключен в этом пространстве`);
    }
    if (isModuleRestricted(restricted, moduleId)) {
      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } }
      });
      if (membership?.role === "member") {
        throw new ForbiddenException(`Модуль «${label}» доступен только владельцу и тимлиду`);
      }
    }
  }

  async enabledSetTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<Set<OrionModuleId>> {
    const { disabled } = await this.overridesTx(tx, workspaceId);
    return new Set(MODULE_CATALOG.map((item) => item.id).filter((id) => !disabled.includes(id)));
  }

  /**
   * The actor-aware counterpart of `enabledSetTx`: disabled modules are
   * excluded for everyone, restricted modules are additionally excluded for
   * plain `member`s (owner/lead see everything that isn't disabled — same
   * rule as `assertEnabledTx`/`effectiveDisabledModules`). Every aggregator
   * that fans out across modules (search, project rollup/activity, entity
   * links, note attachments) must build its queries from this set instead of
   * `enabledSetTx`, otherwise a restricted module's data leaks through the
   * cross-module path even though its own direct endpoint returns 403.
   */
  async accessibleSetTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string
  ): Promise<Set<OrionModuleId>> {
    const { disabled, restricted } = await this.overridesTx(tx, workspaceId);
    const membership = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }
    });
    const isMember = membership?.role === "member";
    return new Set(
      MODULE_CATALOG.map((item) => item.id).filter(
        (id) => !disabled.includes(id) && !(isMember && restricted.includes(id))
      )
    );
  }

  private async overridesTx(
    tx: Prisma.TransactionClient,
    workspaceId: string
  ): Promise<{ disabled: string[]; restricted: string[] }> {
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: { disabledModules: true, restrictedModules: true }
    });
    return { disabled: workspace?.disabledModules ?? [], restricted: workspace?.restrictedModules ?? [] };
  }
}
