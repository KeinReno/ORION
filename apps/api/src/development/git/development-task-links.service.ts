import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  architectMetricsSchema,
  parseCommitTaskRefs,
  type CreateTaskCommitLinkInput,
  type TaskCommitLink,
  type TaskTrace,
  type TaskTraceEntry
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { TaskTraceReader } from "../../tasks/public/task-trace-reader";
import { DevelopmentGitService } from "./development-git.service";

type DbClient = Prisma.TransactionClient;

export interface SyncLinksResult {
  repositoryId: string;
  scannedCommits: number;
  linked: number;
  /** Ссылки, которые не удалось сопоставить задаче этого пространства: номер чужой/несуществующий. */
  unresolved: string[];
}

const MAX_REFS_PER_SYNC = 200;
const QA_REASON = "Для связанных ревизий ещё нет сохранённых результатов анализа Architect.";
const RELEASE_REASON = "Релизы обновлений не привязаны к задаче: в этом пространстве нет записи о выпуске.";

/**
 * Привязка коммитов к задачам (11.2) и таймлайн задачи.
 *
 * Ссылка в сообщении (`#42`) — конвенция, а не доверенный ввод: номер ищется только среди задач
 * ЭТОГО пространства, иначе коммит одного проекта связал бы чужую задачу. Ручная привязка требует
 * `tasks.task.update` (контроллер) и проверяет, что коммит существует в разрешённом репозитории.
 *
 * Автоматические привязки не перезаписывают ручные: `createMany(skipDuplicates)` уважает уже
 * существующую строку, а ручная помечается `manual: true`.
 */
@Injectable()
export class DevelopmentTaskLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly git: DevelopmentGitService,
    private readonly traceReader: TaskTraceReader
  ) {}

  // ── привязки ──────────────────────────────────────────────────────────────────────────────────

  async listLinks(userId: string, workspaceId: string, taskId: string): Promise<TaskCommitLink[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.requireTaskTx(tx, workspaceId, taskId);
      const rows = await tx.taskCommitLink.findMany({
        where: { workspaceId, taskId },
        orderBy: [{ committedAt: "desc" }, { createdAt: "desc" }]
      });
      return rows.map(toLinkDto);
    });
  }

  /** Разбор сообщений истории репозитория. Идемпотентно: повторная синхронизация не создаёт дублей. */
  async syncLinks(userId: string, workspaceId: string, repositoryId: string): Promise<SyncLinksResult> {
    const repository = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
    });
    const repoPath = await this.git.usablePath(repository.path);
    const commits = await this.git.recentCommits(repoPath);
    const refsByCommit: Array<{ commit: (typeof commits)[number]; refs: string[] }> = [];
    const allRefs = new Set<string>();
    for (const commit of commits) {
      const refs = parseCommitTaskRefs(`${commit.subject}\n${commit.message}`, repository.taskRefPrefix);
      if (refs.length === 0) continue;
      refsByCommit.push({ commit, refs });
      for (const ref of refs) allRefs.add(ref);
    }

    const resolved = new Map<string, string>();
    const unresolved: string[] = [];
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      for (const ref of [...allRefs].slice(0, MAX_REFS_PER_SYNC)) {
        const taskId = await this.resolveTaskRefTx(tx, workspaceId, ref);
        if (taskId) resolved.set(ref, taskId);
        else unresolved.push(ref);
      }
    });

    const rows: Prisma.TaskCommitLinkCreateManyInput[] = [];
    for (const { commit, refs } of refsByCommit) {
      for (const ref of refs) {
        const taskId = resolved.get(ref);
        if (!taskId) continue;
        rows.push({
          workspaceId,
          taskId,
          repositoryId: repository.id,
          sha: commit.sha,
          subject: commit.subject,
          author: commit.author,
          committedAt: Number.isFinite(Date.parse(commit.date)) ? new Date(commit.date) : null,
          manual: false
        });
      }
    }
    if (rows.length === 0) return { repositoryId: repository.id, scannedCommits: commits.length, linked: 0, unresolved };
    const linked = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const created = await tx.taskCommitLink.createMany({ data: rows, skipDuplicates: true });
      return created.count;
    });
    return { repositoryId: repository.id, scannedCommits: commits.length, linked, unresolved };
  }

  async linkCommit(userId: string, workspaceId: string, taskId: string, input: CreateTaskCommitLinkInput): Promise<TaskCommitLink> {
    const repository = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.requireTaskTx(tx, workspaceId, taskId);
      return this.git.requireRepositoryTx(tx, workspaceId, input.repositoryId);
    });
    const repoPath = await this.git.usablePath(repository.path);
    const commit = await this.git.findCommit(repoPath, input.sha);
    if (!commit) throw new BadRequestException(`Коммит «${input.sha}» не найден в этом репозитории`);
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.requireTaskTx(tx, workspaceId, taskId);
      const row = await tx.taskCommitLink.upsert({
        where: { taskId_repositoryId_sha: { taskId, repositoryId: repository.id, sha: commit.sha } },
        create: {
          workspaceId,
          taskId,
          repositoryId: repository.id,
          sha: commit.sha,
          subject: commit.subject,
          author: commit.author,
          committedAt: Number.isFinite(Date.parse(commit.date)) ? new Date(commit.date) : null,
          manual: true,
          createdById: userId
        },
        update: { manual: true, subject: commit.subject, author: commit.author, createdById: userId }
      });
      return toLinkDto(row);
    });
  }

  async unlinkCommit(userId: string, workspaceId: string, taskId: string, linkId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.taskCommitLink.findFirst({ where: { id: linkId, workspaceId, taskId } });
      if (!row) throw new NotFoundException("Привязка не найдена");
      await tx.taskCommitLink.delete({ where: { id: row.id } });
    });
  }

  // ── таймлайн задачи ──────────────────────────────────────────────────────────────────────────

  /**
   * Единая цепочка: создание → поручение → изменения → коммиты → проверки → релиз.
   * Для проверки используем только сохранённый результат анализа той же пары репозиторий/SHA.
   */
  async trace(userId: string, workspaceId: string, taskId: string): Promise<TaskTrace> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const source = await this.traceReader.traceSourceTx(tx, workspaceId, taskId);
      if (!source) throw new NotFoundException("Задача не найдена");
      const links = await tx.taskCommitLink.findMany({
        where: { workspaceId, taskId },
        orderBy: [{ committedAt: "asc" }, { createdAt: "asc" }]
      });

      const entries: TaskTraceEntry[] = [
        {
          id: `created:${source.id}`,
          kind: "created",
          at: source.createdAt.toISOString(),
          title: "Задача создана",
          detail: source.title,
          status: source.status,
          links: [{ type: "task", id: source.id, url: null }],
          placeholder: false
        }
      ];

      const assignmentActivity = source.activities.find((activity) => activity.field === "assigneeId");
      if (source.assigneeName || assignmentActivity) {
        const last = [...source.activities].reverse().find((activity) => activity.field === "assigneeId");
        entries.push({
          id: assignmentActivity?.id ?? `assignment:${source.id}`,
          kind: "assignment",
          at: last ? last.createdAt.toISOString() : null,
          title: source.assigneeName ? `Поручено: ${source.assigneeName}` : "Поручение снято",
          detail: last ? `Было: ${last.fromValue ?? "без исполнителя"} → стало: ${last.toValue ?? "без исполнителя"}` : null,
          status: source.assigneeName,
          links: [],
          placeholder: false
        });
      }

      for (const activity of source.activities) {
        if (activity.field === "assigneeId") continue;
        const actor = activity.agentName ? `Агент «${activity.agentName}»` : activity.actorName;
        entries.push({
          id: activity.id,
          kind: "status",
          at: activity.createdAt.toISOString(),
          title:
            activity.field === "status"
              ? `Статус: ${activity.fromValue ?? "—"} → ${activity.toValue ?? "—"}`
              : activity.field === "dueAt"
                ? "Изменён срок"
                : `Изменение поля «${activity.field}»`,
          detail: actor ? `Кто: ${actor}` : null,
          status: activity.field === "status" ? activity.toValue : null,
          links: [],
          placeholder: false
        });
      }

      for (const link of links) {
        entries.push({
          id: link.id,
          kind: "commit",
          at: (link.committedAt ?? link.createdAt).toISOString(),
          title: `Коммит ${link.sha.slice(0, 8)}`,
          detail: link.subject,
          status: link.manual ? "ручная привязка" : null,
          links: [{ type: "commit", id: link.sha, url: null }],
          placeholder: false
        });
      }

      const snapshots = links.length ? await tx.developmentArchitectSnapshot.findMany({
        where: { workspaceId, OR: links.map(({ repositoryId, sha }) => ({ repositoryId, sha })) },
        select: { id: true, repositoryId: true, sha: true, createdAt: true, metrics: true, truncated: true }
      }) : [];
      for (const snapshot of snapshots) {
        const metrics = architectMetricsSchema.safeParse(snapshot.metrics);
        entries.push({
          id: `check:${snapshot.id}`,
          kind: "check",
          at: snapshot.createdAt.toISOString(),
          title: `Структурный анализ Architect · ${snapshot.sha.slice(0, 8)}`,
          detail: metrics.success ? `Файлов: ${metrics.data.files} · Внутренних связей: ${metrics.data.internalEdges} · Внешних связей: ${metrics.data.externalEdges}` : null,
          status: snapshot.truncated ? "Карта неполная" : "Карта построена",
          links: [
            { type: "architect-snapshot", id: snapshot.id, url: null },
            { type: "commit", id: snapshot.sha, url: null },
            { type: "repository", id: snapshot.repositoryId, url: null }
          ],
          placeholder: false
        });
      }
      if (!snapshots.length) entries.push({
        id: `check:${source.id}`,
        kind: "check",
        at: null,
        title: "Нет результатов анализа",
        detail: QA_REASON,
        status: null,
        links: [],
        placeholder: true
      });
      entries.push({
        id: `release:${source.id}`,
        kind: "release",
        at: null,
        title: "Релиз не привязан",
        detail: RELEASE_REASON,
        status: null,
        links: [],
        placeholder: true
      });

      entries.sort((a, b) => {
        if (a.at === null && b.at === null) return 0;
        if (a.at === null) return 1;
        if (b.at === null) return -1;
        return Date.parse(a.at) - Date.parse(b.at);
      });

      return {
        workspaceId,
        taskId,
        title: source.title,
        status: source.status,
        entries,
        qa: { available: snapshots.length > 0, reason: snapshots.length ? "Показан сохранённый структурный анализ Architect." : QA_REASON },
        release: { linked: false, tag: null }
      };
    });
  }

  // ── ссылки на задачи ─────────────────────────────────────────────────────────────────────────

  private async requireTaskTx(tx: DbClient, workspaceId: string, taskId: string): Promise<void> {
    const source = await this.traceReader.traceSourceTx(tx, workspaceId, taskId);
    if (!source) throw new NotFoundException("Задача не найдена");
  }

  /**
   * `#42` — 42-я задача пространства по порядку создания (у задачи нет своего короткого номера в
   * схеме); `#3f2a1b`/полный uuid — начало идентификатора. Поиск идёт через публичный контракт
   * tasks: чужое пространство и несуществующая ссылка не находятся.
   */
  private async resolveTaskRefTx(tx: DbClient, workspaceId: string, ref: string): Promise<string | null> {
    if (/^\d{1,9}$/.test(ref)) {
      const ordinal = Number(ref);
      if (ordinal < 1) return null;
      return this.traceReader.resolveReferenceTx(tx, workspaceId, { ordinal });
    }
    if (!/^[0-9a-fA-F-]{4,36}$/.test(ref)) return null;
    return this.traceReader.resolveReferenceTx(tx, workspaceId, { idPrefix: ref.toLowerCase() });
  }
}

function toLinkDto(row: {
  id: string;
  taskId: string;
  repositoryId: string;
  sha: string;
  subject: string;
  author: string;
  committedAt: Date | null;
  manual: boolean;
  createdAt: Date;
}): TaskCommitLink {
  return {
    id: row.id,
    taskId: row.taskId,
    repositoryId: row.repositoryId,
    sha: row.sha,
    subject: row.subject,
    author: row.author,
    committedAt: row.committedAt?.toISOString() ?? null,
    manual: row.manual,
    createdAt: row.createdAt.toISOString()
  };
}
