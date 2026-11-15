import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  architectProjectSchemaSchema,
  compareArchitectSchemas,
  type ArchitectComparison,
  type ArchitectLayout,
  type ArchitectLayoutInput,
  type ArchitectMap,
  type ArchitectNodePosition,
  type ArchitectProjectSchema
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { DevelopmentGitService } from "../git/development-git.service";
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
    let analysisRoot = repoPath;
    let cleanup: (() => Promise<void>) | null = null;
    if (ref) {
      try {
        const prepared = await prepareAnalysisRoot(repoPath, ref);
        analysisRoot = prepared.rootPath;
        cleanup = prepared.cleanup;
      } catch (error) {
        throw new BadRequestException(`Не удалось получить ревизию «${ref}»: ${(error as Error).message}`);
      }
    }
    let analysis;
    try {
      analysis = await analyzeRepository({ rootPath: analysisRoot, subPath: normalized });
    } catch (error) {
      throw new BadRequestException(`Не удалось построить карту: ${(error as Error).message}`);
    } finally {
      if (cleanup) await cleanup().catch(() => undefined);
    }
    const layout = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.developmentArchitectLayout.findUnique({ where: { workspaceId_repositoryId: { workspaceId, repositoryId } } });
    });
    const positions = new Map<string, { x: number; y: number }>();
    for (const entry of readPositions(layout?.nodes)) positions.set(entry.id, { x: entry.x, y: entry.y });
    return {
      repository: { id: repository.id, name: repository.name },
      path: normalized,
      nodes: analysis.nodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, x: position.x, y: position.y } : node;
      }),
      edges: analysis.edges,
      metrics: analysis.metrics,
      layoutRevision: layout?.revision ?? 0,
      truncated: analysis.truncated
    };
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
