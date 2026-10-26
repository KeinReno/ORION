import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  enabledHardDependents,
  isComponentRequired,
  isOrionPluginId,
  isPluginEnabled,
  MODULE_CATALOG,
  PLUGIN_CATALOG,
  pluginStates,
  type ComponentHasDependentsError,
  type OrionPluginId,
  type PluginManifest,
  type WorkspacePluginState
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ModulesService } from "../modules/modules.service";
import { CapabilityLifecycle } from "../common/capability-lifecycle";
import { assertComponentCompatible } from "../common/component-compatibility";

@Injectable()
export class PluginsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly lifecycle: CapabilityLifecycle
  ) {}

  catalog(): readonly PluginManifest[] {
    return PLUGIN_CATALOG;
  }

  async list(userId: string, workspaceId: string): Promise<WorkspacePluginState[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const disabled = await this.pluginOverridesTx(tx, workspaceId);
      const enabledModules = await this.modules.enabledSetTx(tx, workspaceId);
      return pluginStates(disabled, enabledModules);
    });
  }

  async setEnabled(userId: string, workspaceId: string, pluginId: string, enabled: boolean, confirm = false): Promise<WorkspacePluginState[]> {
    if (!isOrionPluginId(pluginId)) throw new NotFoundException("Плагин не найден");
    const manifest = PLUGIN_CATALOG.find((item) => item.id === pluginId);
    if (!manifest) throw new NotFoundException("Плагин не найден");
    if (!enabled && isComponentRequired("plugin", pluginId)) {
      throw new ConflictException({ code: "component_required", message: `Плагин «${manifest.label}» обязателен — его нельзя выключить` });
    }

    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } }
      });
      if (membership?.role !== "owner") {
        throw new ForbiddenException("Только владелец может менять состав плагинов");
      }

      // pluginOverrides holds ids that differ from the manifest's default —
      // not a flat "disabled" list (a plugin can default off, unlike every
      // module). Requesting the default state removes the override instead
      // of always adding/removing the same way `disabledModules` does.
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      const enabledModulesNow = await this.modules.enabledSetTx(tx, workspaceId);
      if (enabled) assertComponentCompatible(pluginId, enabledModulesNow);
      const current = new Set(await this.pluginOverridesTx(tx, workspaceId));
      if (!enabled && !confirm) {
        const disabledModules = [...new Set(MODULE_CATALOG.map((item) => item.id))].filter(
          (id) => !enabledModulesNow.has(id)
        );
        const dependents = enabledHardDependents(pluginId, { disabledModules, pluginOverrides: [...current] });
        if (dependents.length > 0) {
          const body: ComponentHasDependentsError = {
            code: "component_has_dependents",
            message: `Вместе с плагином «${manifest.label}» перестанут работать: ${dependents.map((item) => `«${item.label}»`).join(", ")}`,
            dependents
          };
          throw new ConflictException(body);
        }
      }
      if (enabled === manifest.defaultEnabled) current.delete(pluginId);
      else current.add(pluginId);

      await tx.workspace.update({ where: { id: workspaceId }, data: { pluginOverrides: [...current] } });
      await this.lifecycle.changedTx(tx, { kind: "plugin", id: pluginId, enabled, workspaceId, actorId: userId });
      const enabledModules = await this.modules.enabledSetTx(tx, workspaceId);
      return pluginStates([...current], enabledModules);
    });
  }

  async assertEnabled(userId: string, workspaceId: string, pluginId: OrionPluginId): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertEnabledTx(tx, userId, workspaceId, pluginId);
    });
  }

  async assertEnabledTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    pluginId: OrionPluginId
  ): Promise<void> {
    const manifest = PLUGIN_CATALOG.find((item) => item.id === pluginId);
    const label = manifest?.label ?? pluginId;
    if (!manifest) throw new NotFoundException("Плагин не найден");

    await this.modules.assertEnabledTx(tx, userId, workspaceId, manifest.extendsModuleId);

    const disabled = await this.pluginOverridesTx(tx, workspaceId);
    if (!isPluginEnabled(disabled, pluginId)) {
      throw new ConflictException(`Плагин «${label}» выключен в этом пространстве`);
    }
    assertComponentCompatible(pluginId, await this.modules.enabledSetTx(tx, workspaceId));
  }

  private async pluginOverridesTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<string[]> {
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { pluginOverrides: true } });
    return workspace?.pluginOverrides ?? [];
  }
}
