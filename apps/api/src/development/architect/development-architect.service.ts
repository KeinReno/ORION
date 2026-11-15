import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  architectEdgeSchema,
  architectMetricsSchema,
  architectNodeSchema,
  architectProjectSchemaSchema,
  compareArchitectSchemas,
  diffArchitectMaps,
  type ArchitectComparison,
  type ArchitectLayout,
  type ArchitectLayoutInput,
  type ArchitectMap,
  type ArchitectMapDiff,
  type ArchitectNodePosition,
  type ArchitectProjectSchema,
  type ArchitectSnapshot,
  type ArchitectSnapshotSummary
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { DevelopmentGitService } from "../git/development-git.service";
import { resolveCommitSha } from "../git/git-command";
import type { GitFileActivity } from "../git/git-graph-parser";
import { analyzeRepository, normalizeSubPath } from "./architect-analyzer";
import { prepareAnalysisRoot } from "./architect-ref";

/**
 * Architect (11.3): карта строится анализатором при каждом запросе, а в БД живут только
 * пользовательские данные — позиции узлов и загруженная проектная схема. Поэтому изменение кода
 * видно сразу, а раскладка не устаревает вместе с файлами (её узлы сопоставляются по id-пути).
 *
 * Ревизия растёт на каждой записи: параллельная вкладка не затрёт чужую раскладку без явного
 * `expectedRevision` (412), как у canvas-layout в задании 08.
 */
@Injectable()
export class DevelopmentArchitectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly git: DevelopmentGitService
  ) {}

  async map(userId: string, workspaceId: string, repositoryId: string, subPath?: string, ref?: string): Promise<ArchitectMap> {
    const repository = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
    });
    const repoPath = await this.git.usablePath(repository.path);
    let normalized: string;
    try {
      normalized = normalizeSubPath(repoPath, subPath ?? "");
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    /** Ревизия анализируется в отдельном временном clone: исходный репозиторий не меняется. */
    let analysis;
    try {
      analysis = await this.analyzeRef(repoPath, ref, normalized);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const prefix = ref ? `Не удалось получить ревизию «${ref}»` : "Не удалось построить карту";
      throw new BadRequestException(`${prefix}: ${(error as Error).message}`);
    }
    const activityMap = await this.git.recentCommitFiles(repoPath, ref ?? undefined).catch(() => new Map<string, GitFileActivity>());
    const nodes = this.attachActivity(analysis.nodes, activityMap);
    const layout = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.developmentArchitectLayout.findUnique({ where: { workspaceId_repositoryId: { workspaceId, repositoryId } } });
    });
    const positions = new Map<string, { x: number; y: number }>();
    for (const entry of readPositions(layout?.nodes)) positions.set(entry.id, { x: entry.x, y: entry.y });
    return {
      repository: { id: repository.id, name: repository.name },
      path: normalized,
      nodes: nodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, x: position.x, y: position.y } : node;
      }),
      edges: analysis.edges,
      metrics: analysis.metrics,
      layoutRevision: layout?.revision ?? 0,
      truncated: analysis.truncated
    };
  }

  /**
   * Анализ корня (или подкаталога) репозитория; `ref` разворачивается во временный каталог
   * (`git archive`) и подчищается. Исходная рабочая копия не изменяется.
   */
  private async analyzeRef(repoPath: string, ref?: string, subPath?: string) {
    if (!ref) return analyzeRepository({ rootPath: repoPath, subPath: subPath ?? "" });
    const prepared = await prepareAnalysisRoot(repoPath, ref);
    try {
      return await analyzeRepository({ rootPath: prepared.rootPath, subPath: subPath ?? "" });
    } finally {
      await prepared.cleanup();
    }
  }

  /**
   * Прикрепляет к узлам активность из git: файлам — их последний коммит, каталогам — самый
   * свежий среди вложенных (подъём по родителям от глубоких узлов к корню). Файлы вне прочитанной
   * истории получают `null`, карта от этого не ломается.
   */
  private attachActivity<T extends { id: string; parentId: string | null; depth: number; kind: string }>(
    nodes: T[],
    activity: ReadonlyMap<string, GitFileActivity>
  ): Array<T & { lastCommitAt: string | null; lastAuthor: string | null; lastCommitSubject: string | null }> {
    type Activity = { at: string; author: string; subject: string };
    const parentOf = new Map(nodes.map(node => [node.id, node.parentId]));
    const depthOf = new Map(nodes.map(node => [node.id, node.depth]));
    const best = new Map<string, Activity>();
    for (const node of nodes) {
      if (node.kind !== "file") continue;
      const entry = activity.get(node.id);
      if (entry) best.set(node.id, { at: entry.at, author: entry.author, subject: entry.subject });
    }
    const byDepthDesc = [...best.keys()]
      .map(id => ({ id, depth: depthOf.get(id) ?? 0 }))
      .sort((a, b) => b.depth - a.depth);
    for (const { id } of byDepthDesc) {
      const parentId = parentOf.get(id);
      if (!parentId) continue;
      const mine = best.get(id) as Activity;
      const theirs = best.get(parentId);
      if (!theirs || mine.at > theirs.at) best.set(parentId, mine);
    }
    return nodes.map(node => {
      const entry = best.get(node.id);
      return {
        ...node,
        lastCommitAt: entry?.at ?? null,
        lastAuthor: entry?.author ?? null,
        lastCommitSubject: entry?.subject ?? null
      };
    });
  }

  // ── снапшоты ──────────────────────────────────────────────────────────────────────────────

  /** Снимает снапшот на ревизии; если снапшот для этого sha уже есть — возвращает его как есть. */
  async createSnapshot(userId: string, workspaceId: string, repositoryId: string, ref?: string): Promise<ArchitectSnapshotSummary> {
    const repository = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      return this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
    });
    const repoPath = await this.git.usablePath(repository.path);
    const resolvedRef = ref?.trim() || "HEAD";
    let sha: string | null = null;
    try {
      sha = await resolveCommitSha(repoPath, resolvedRef);
    } catch {
      sha = null;
    }
    if (!sha) throw new BadRequestException(`Ссылка «${resolvedRef}» не найдена в репозитории`);
    const existing = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.developmentArchitectSnapshot.findUnique({ where: { workspaceId_repositoryId_sha: { workspaceId, repositoryId, sha } } });
    });
    if (existing) return toSnapshotSummary(existing);
    let analysis;
    try {
      analysis = await this.analyzeRef(repoPath, resolvedRef);
    } catch (error) {
      throw new BadRequestException(`Не удалось построить карту для снапшота: ${(error as Error).message}`);
    }
    const activityMap = await this.git.recentCommitFiles(repoPath, sha).catch(() => new Map<string, GitFileActivity>());
    const nodesWithActivity = this.attachActivity(analysis.nodes, activityMap);
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.developmentArchitectSnapshot.create({
        data: {
          workspaceId,
          repositoryId,
          sha,
          nodes: nodesWithActivity as unknown as Prisma.InputJsonValue,
          edges: analysis.edges as unknown as Prisma.InputJsonValue,
          metrics: analysis.metrics as unknown as Prisma.InputJsonValue,
          truncated: analysis.truncated,
          createdById: userId
        }
      });
    });
    return toSnapshotSummary(row);
  }

  async listSnapshots(userId: string, workspaceId: string, repositoryId: string): Promise<ArchitectSnapshotSummary[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
      const rows = await tx.developmentArchitectSnapshot.findMany({
        where: { workspaceId, repositoryId },
        orderBy: { createdAt: "desc" }
      });
      return rows.map(toSnapshotSummary);
    });
  }

  async snapshot(userId: string, workspaceId: string, repositoryId: string, sha: string): Promise<ArchitectSnapshot> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
      const row = await tx.developmentArchitectSnapshot.findUnique({ where: { workspaceId_repositoryId_sha: { workspaceId, repositoryId, sha } } });
      if (!row) throw new NotFoundException("Снапшот не найден");
      return toSnapshotDto(row);
    });
  }

  /** Диф карт между двумя ревизиями: обе разворачиваются параллельно, разница — чистой функцией. */
  async diff(userId: string, workspaceId: string, repositoryId: string, baseRef: string, targetRef: string): Promise<ArchitectMapDiff> {
    const repository = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
    });
    const repoPath = await this.git.usablePath(repository.path);
    const load = async (ref: string) => {
      try {
        return await this.analyzeRef(repoPath, ref);
      } catch (error) {
        throw new BadRequestException(`Не удалось получить ревизию «${ref}»: ${(error as Error).message}`);
      }
    };
    const [baseAnalysis, targetAnalysis] = await Promise.all([load(baseRef), load(targetRef)]);
    return diffArchitectMaps(
      { nodes: baseAnalysis.nodes, edges: baseAnalysis.edges },
      { nodes: targetAnalysis.nodes, edges: targetAnalysis.edges }
    );
  }

  async layout(userId: string, workspaceId: string, repositoryId: string): Promise<ArchitectLayout> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
      const row = await tx.developmentArchitectLayout.findUnique({ where: { workspaceId_repositoryId: { workspaceId, repositoryId } } });
      return toLayoutDto(repositoryId, row);
    });
  }

  async saveLayout(userId: string, workspaceId: string, repositoryId: string, input: ArchitectLayoutInput): Promise<ArchitectLayout> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
      const row = await tx.developmentArchitectLayout.findUnique({ where: { workspaceId_repositoryId: { workspaceId, repositoryId } } });
      if (row && input.expectedRevision !== undefined && input.expectedRevision !== row.revision) {
        throw new ConflictException({ code: "layout_revision_mismatch", revision: row.revision });
      }
      const nodes = dedupePositions(input.nodes);
      const viewport = input.viewport ?? readViewport(row?.viewport);
      const saved = row
        ? await tx.developmentArchitectLayout.update({
            where: { id: row.id },
            data: { nodes, viewport: viewport ?? {}, revision: row.revision + 1 }
          })
        : await tx.developmentArchitectLayout.create({
            data: { workspaceId, repositoryId, nodes, viewport: viewport ?? {}, revision: 1 }
          });
      return toLayoutDto(repositoryId, saved);
    });
  }

  async projectSchema(userId: string, workspaceId: string, repositoryId: string): Promise<ArchitectProjectSchema | null> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.developmentArchitectLayout.findUnique({ where: { workspaceId_repositoryId: { workspaceId, repositoryId } } });
      if (!row?.projectSchema) return null;
      const parsed = architectProjectSchemaSchema.safeParse(row.projectSchema);
      return parsed.success ? parsed.data : null;
    });
  }

  async saveProjectSchema(userId: string, workspaceId: string, repositoryId: string, schema: ArchitectProjectSchema): Promise<ArchitectProjectSchema> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
      const row = await tx.developmentArchitectLayout.findUnique({ where: { workspaceId_repositoryId: { workspaceId, repositoryId } } });
      const value = schema as unknown as Prisma.InputJsonValue;
      if (row) {
        await tx.developmentArchitectLayout.update({
          where: { id: row.id },
          data: { projectSchema: value, revision: row.revision + 1 }
        });
      } else {
        await tx.developmentArchitectLayout.create({
          data: { workspaceId, repositoryId, projectSchema: value, revision: 1 }
        });
      }
      return schema;
    });
  }

  /** Сравнение загруженной проектной схемы с фактическим анализом корня репозитория. */
  async compare(userId: string, workspaceId: string, repositoryId: string): Promise<ArchitectComparison> {
    const repository = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.git.requireRepositoryTx(tx, workspaceId, repositoryId);
    });
    const project = await this.projectSchema(userId, workspaceId, repositoryId);
    if (!project) throw new ConflictException({ code: "project_schema_missing", message: "Проектная схема ещё не загружена" });
    const repoPath = await this.git.usablePath(repository.path);
    const analysis = await analyzeRepository({ rootPath: repoPath });
    return compareArchitectSchemas(repositoryId, project, {
      nodes: analysis.nodes.map((node) => ({ id: node.id, kind: node.kind })),
      edges: analysis.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind }))
    });
  }
}

function readPositions(value: unknown): ArchitectNodePosition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ArchitectNodePosition =>
      typeof entry === "object" && entry !== null &&
      typeof (entry as ArchitectNodePosition).id === "string" &&
      typeof (entry as ArchitectNodePosition).x === "number" &&
      typeof (entry as ArchitectNodePosition).y === "number"
  );
}

function dedupePositions(nodes: readonly ArchitectNodePosition[]): ArchitectNodePosition[] {
  const byId = new Map<string, ArchitectNodePosition>();
  for (const node of nodes) byId.set(node.id, { id: node.id, x: node.x, y: node.y });
  return [...byId.values()];
}

function readViewport(value: unknown): { x: number; y: number; zoom: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const viewport = value as { x?: unknown; y?: unknown; zoom?: unknown };
  if (typeof viewport.x !== "number" || typeof viewport.y !== "number" || typeof viewport.zoom !== "number") return null;
  return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
}

function toLayoutDto(
  repositoryId: string,
  row: { nodes: Prisma.JsonValue; viewport: Prisma.JsonValue; revision: number; updatedAt: Date } | null
): ArchitectLayout {
  return {
    repositoryId,
    nodes: readPositions(row?.nodes),
    viewport: readViewport(row?.viewport),
    revision: row?.revision ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null
  };
}

type SnapshotRow = {
  repositoryId: string;
  sha: string;
  nodes: Prisma.JsonValue;
  edges: Prisma.JsonValue;
  metrics: Prisma.JsonValue;
  truncated: boolean;
  createdById: string | null;
  createdAt: Date;
};

const EMPTY_METRICS: ArchitectSnapshotSummary["metrics"] = { files: 0, directories: 0, modules: 0, crates: 0, edges: 0, internalEdges: 0, externalEdges: 0, bytes: 0 };

function parseSnapshotMetrics(value: Prisma.JsonValue): ArchitectSnapshotSummary["metrics"] {
  const parsed = architectMetricsSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_METRICS;
}

function toSnapshotSummary(row: SnapshotRow): ArchitectSnapshotSummary {
  return {
    repositoryId: row.repositoryId,
    sha: row.sha,
    nodes: Array.isArray(row.nodes) ? row.nodes.length : 0,
    edges: Array.isArray(row.edges) ? row.edges.length : 0,
    metrics: parseSnapshotMetrics(row.metrics),
    truncated: row.truncated,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString()
  };
}

function toSnapshotDto(row: SnapshotRow): ArchitectSnapshot {
  const nodes = architectNodeSchema.array().safeParse(row.nodes);
  const edges = architectEdgeSchema.array().safeParse(row.edges);
  return {
    repositoryId: row.repositoryId,
    sha: row.sha,
    nodes: nodes.success ? nodes.data : [],
    edges: edges.success ? edges.data : [],
    metrics: parseSnapshotMetrics(row.metrics),
    truncated: row.truncated,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString()
  };
}
