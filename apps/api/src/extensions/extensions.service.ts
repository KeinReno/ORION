import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  ORION_MODULE_IDS,
  ORION_PLUGIN_IDS,
  PLATFORM_API_VERSION,
  type ApproveExtensionInput,
  type ExtensionInfo,
  type ExtensionManifest,
  type ExtensionsState,
  type UpdateExtensionInput
} from "@orion/shared-types";
import { resolveMode } from "../common/orion-mode";
import { PrismaService } from "../common/prisma.service";
import { LanService } from "../lan/lan.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { nodeDir, writeJsonAtomic } from "../lan/node-config";
import { extensionsDir, folderFingerprint, scanExtensions, statusOf, type ExtensionApproval, type ScannedExtension } from "./extension-scan";

const POLL_MS = 2_000;

/**
 * Загрузчик расширений (ADR-0022, E2). Подтверждения хранятся файлом `extensions.json` в каталоге узла, как настройки
 * обновлений: они относятся ко всей установке, а не к пространству, и в резервную копию пространства не входят.
 * Папку расширений сервис опрашивает раз в 2 с (отпечаток имён, размеров и времени файлов): так видна и папка, созданная
 * после старта, и правка в режиме разработчика; `revision` растёт, интерфейс по нему перезагружает расширения.
 */
@Injectable()
export class ExtensionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExtensionsService.name);
  private readonly dir = extensionsDir();
  private revision = 1;
  private fingerprint = "";
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lan: LanService,
    private readonly workspaces: WorkspacesService
  ) {}

  onModuleInit(): void {
    if (this.availability().reason !== null) return;
    this.fingerprint = this.safeFingerprint();
    this.timer = setInterval(() => {
      const next = this.safeFingerprint();
      if (next !== this.fingerprint) {
        this.fingerprint = next;
        this.revision += 1;
      }
    }, POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Расширения — только локальная установка: не сервер (без явного ORION_EXTENSIONS=on) и не клиент LAN. */
  availability(): { reason: string | null } {
    if (resolveMode() === "server" && process.env.ORION_EXTENSIONS !== "on") return { reason: "На сервере расширения выключены (ORION_EXTENSIONS=on включает их осознанно)." };
    if (this.lan.isClientMode()) return { reason: "В режиме клиента LAN расширения не загружаются: ими управляет каждый компьютер сам." };
    return { reason: null };
  }

  async state(userId: string): Promise<ExtensionsState> {
    const { reason } = this.availability();
    const canManage = await this.canManage(userId);
    if (reason) return { available: false, reason, dir: null, revision: this.revision, canManage: false, items: [] };
    const approvals = this.readApprovals();
    const items = this.scan().map((scanned) => this.toInfo(scanned, approvals[scanned.id]));
    return { available: true, reason: null, dir: this.dir, revision: this.revision, canManage, items };
  }

  async approve(userId: string, id: string, input: ApproveExtensionInput): Promise<ExtensionInfo> {
    await this.assertManager(userId);
    const scanned = this.find(id);
    const status = statusOf(scanned, undefined, PLATFORM_API_VERSION);
    if (status === "invalid") throw new ConflictException({ code: "extension_invalid", message: `Расширение с ошибками: ${scanned.problems.join("; ")}` });
    if (status === "incompatible") throw new ConflictException({ code: "extension_incompatible", message: `Расширение требует ORION ${scanned.manifest?.engines.orion}, а здесь ${PLATFORM_API_VERSION}` });
    if (scanned.sha256 !== input.sha256) {
      throw new ConflictException({ code: "extension_changed", message: "Файлы расширения изменились, пока вы его смотрели. Проверьте ещё раз." });
    }
    const approvals = this.readApprovals();
    approvals[id] = {
      version: scanned.manifest!.version,
      sha256: scanned.sha256,
      enabled: true,
      devMode: approvals[id]?.devMode ?? false,
      approvedBy: userId,
      approvedAt: new Date().toISOString()
    };
    this.writeApprovals(approvals);
    this.logger.log(`Расширение ${id} ${scanned.manifest!.version} подтверждено пользователем ${userId}`);
    return this.toInfo(scanned, approvals[id]);
  }

  async update(userId: string, id: string, input: UpdateExtensionInput): Promise<ExtensionInfo> {
    await this.assertManager(userId);
    const scanned = this.find(id);
    const approvals = this.readApprovals();
    const current = approvals[id];
    if (!current) throw new ConflictException({ code: "extension_not_approved", message: "Сначала подтвердите расширение." });
    approvals[id] = { ...current, ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.devMode !== undefined ? { devMode: input.devMode } : {}) };
    this.writeApprovals(approvals);
    return this.toInfo(scanned, approvals[id]);
  }

  /** Включить/выключить подтверждённое расширение в одном пространстве — решает владелец этого пространства. */
  async setWorkspace(userId: string, id: string, workspaceId: string, enabled: boolean): Promise<ExtensionInfo> {
    this.assertAvailable();
    await this.prisma.withUser(userId, (tx) => this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]));
    const scanned = this.find(id);
    const approvals = this.readApprovals();
    const current = approvals[id];
    if (!current) throw new ConflictException({ code: "extension_not_approved", message: "Сначала подтвердите расширение." });
    const disabled = new Set(current.disabledWorkspaces ?? []);
    if (enabled) disabled.delete(workspaceId);
    else disabled.add(workspaceId);
    approvals[id] = { ...current, disabledWorkspaces: [...disabled] };
    this.writeApprovals(approvals);
    return this.toInfo(scanned, approvals[id]);
  }

  async revoke(userId: string, id: string): Promise<void> {
    await this.assertManager(userId);
    const approvals = this.readApprovals();
    if (!approvals[id]) return;
    delete approvals[id];
    this.writeApprovals(approvals);
  }

  /** Создаёт папку (если её нет) и открывает её в Проводнике этого компьютера. */
  async openFolder(userId: string): Promise<{ dir: string }> {
    await this.assertManager(userId);
    this.assertAvailable();
    fs.mkdirSync(this.dir, { recursive: true });
    if (process.platform === "win32") spawn("explorer.exe", [this.dir], { detached: true, stdio: "ignore" }).unref();
    return { dir: this.dir };
  }

  /**
   * Код расширения для `import()`. Байты читаются один раз и сверяются с подтверждённым хешем (кроме режима разработчика):
   * подменить файл между проверкой и отдачей нельзя.
   */
  entry(id: string): Buffer {
    this.assertAvailable();
    const scanned = this.find(id);
    const approval = this.readApprovals()[id];
    if (statusOf(scanned, approval, PLATFORM_API_VERSION) !== "approved" || !scanned.entryFile) {
      throw new NotFoundException("Расширение не подтверждено или выключено");
    }
    return fs.readFileSync(scanned.entryFile);
  }

  /**
   * Манифест расширения, которое сейчас работает (подтверждено, включено, код не менялся или режим разработчика) —
   * условие для его данных, секретов и сети (E3). Выключенное расширение не получает ничего.
   */
  requireActive(id: string, workspaceId?: string): ExtensionManifest {
    this.assertAvailable();
    const scanned = this.find(id);
    const approval = this.readApprovals()[id];
    if (statusOf(scanned, approval, PLATFORM_API_VERSION) !== "approved" || !scanned.manifest) {
      throw new ConflictException({ code: "extension_inactive", message: "Расширение не подтверждено или выключено" });
    }
    if (workspaceId && approval?.disabledWorkspaces?.includes(workspaceId)) {
      throw new ConflictException({ code: "extension_inactive", message: "Расширение выключено в этом пространстве" });
    }
    return scanned.manifest;
  }

  private toInfo(scanned: ScannedExtension, approval: ExtensionApproval | undefined): ExtensionInfo {
    const status = statusOf(scanned, approval, PLATFORM_API_VERSION);
    const manifest = scanned.manifest;
    const problems = [...scanned.problems];
    if (status === "incompatible" && manifest) problems.push(`Нужен ORION ${manifest.engines.orion}, установлен ${PLATFORM_API_VERSION}`);
    return {
      id: scanned.id,
      folder: scanned.folder,
      name: manifest?.name ?? scanned.folder,
      version: manifest?.version ?? null,
      description: manifest?.description ?? "",
      author: manifest?.author ?? null,
      status,
      problems,
      sha256: scanned.sha256,
      permissions: manifest ? { network: manifest.permissions.network, secrets: manifest.permissions.secrets, storage: manifest.permissions.storage } : null,
      devMode: approval?.devMode ?? false,
      approvedVersion: approval?.version ?? null,
      approvedAt: approval?.approvedAt ?? null,
      disabledWorkspaceIds: approval?.disabledWorkspaces ?? [],
      // The hash in the URL busts the module cache when the code changes (dev mode reloads it).
      entryPath: status === "approved" && scanned.sha256 ? `/extensions/${encodeURIComponent(scanned.id)}/web.js?h=${scanned.sha256.slice(0, 16)}` : null
    };
  }

  private scan(): ScannedExtension[] {
    return scanExtensions(this.dir, new Set<string>([...ORION_MODULE_IDS, ...ORION_PLUGIN_IDS]));
  }

  private find(id: string): ScannedExtension {
    const scanned = this.scan().find((item) => item.id === id && item.manifest);
    if (!scanned) throw new NotFoundException("Расширение не найдено в папке расширений");
    return scanned;
  }

  private assertAvailable(): void {
    const { reason } = this.availability();
    if (reason) throw new ForbiddenException(reason);
  }

  /** Решение владельца: подтверждает и выключает любой локальный пользователь, владеющий хотя бы одним пространством. */
  private async canManage(userId: string): Promise<boolean> {
    const owned = await this.prisma.withUser(userId, (tx) => tx.workspaceMember.count({ where: { userId, role: "owner" } }));
    return owned > 0;
  }

  private async assertManager(userId: string): Promise<void> {
    this.assertAvailable();
    if (!(await this.canManage(userId))) throw new ForbiddenException("Управлять расширениями может владелец хотя бы одного пространства");
  }

  private approvalsPath(): string {
    return path.join(nodeDir(), "extensions.json");
  }

  private readApprovals(): Record<string, ExtensionApproval> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.approvalsPath(), "utf8")) as { approvals?: Record<string, ExtensionApproval> };
      return raw.approvals ?? {};
    } catch {
      return {};
    }
  }

  private writeApprovals(approvals: Record<string, ExtensionApproval>): void {
    writeJsonAtomic(this.approvalsPath(), { approvals });
    this.revision += 1;
  }

  private safeFingerprint(): string {
    try {
      return folderFingerprint(this.dir);
    } catch (error) {
      this.logger.warn(`Папка расширений недоступна: ${(error as Error).message}`);
      return "unavailable";
    }
  }
}
