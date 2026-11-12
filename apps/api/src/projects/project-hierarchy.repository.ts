import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectAncestor } from "@orion/shared-types";

/**
 * Дерево проектов (задание 03): `Project.parentId` — self-ref. Ancestor/потомок-запросы —
 * рекурсивный CTE через `$queryRaw` (Prisma не умеет рекурсию выразительно). Сырой SQL здесь
 * сознательно ограничен проектами: чужих таблиц не читает.
 *
 * Почему отдельный репозиторий: проверка цикла, ограничение глубины, дерево для портфеля и
 * подпись «где я в дереве» должны считать ОДНОЙ функцией, иначе UI и валидация разойдутся.
 */
@Injectable()
export class ProjectHierarchyRepository {
  /**
   * Цепочка от проекта вверх до корня: `[сам проект, родитель, …, корень]`.
   * Включает сам проект — это нужно и для проверки цикла, и для «пути» в ошибке.
   */
  async chainTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<Array<{ id: string; name: string }>> {
    return tx.$queryRaw<Array<{ id: string; name: string }>>`
      WITH RECURSIVE chain AS (
        SELECT p."id", p."name", p."parentId", 1 AS step
        FROM "projects" p
        WHERE p."id" = ${projectId} AND p."workspaceId" = ${workspaceId}
        UNION ALL
        SELECT parent."id", parent."name", parent."parentId", chain.step + 1
        FROM "projects" parent
        JOIN chain ON parent."id" = chain."parentId"
        WHERE parent."workspaceId" = ${workspaceId} AND chain.step < 64
      )
      SELECT "id", "name" FROM chain ORDER BY step ASC`;
  }

  /** Путь от корня до непосредственного родителя (без самого проекта) — для `ProjectDetail.ancestors`. */
  async ancestorsTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<ProjectAncestor[]> {
    const chain = await this.chainTx(tx, workspaceId, projectId);
    return chain
      .slice(1)
      .reverse()
      .map((row, index) => ({ id: row.id, name: row.name, depth: index + 1 }));
  }

  /**
   * Наибольшая глубина поддерева под проектом (0 — детей нет). Нужна при смене родителя:
   * новый уровень проекта + глубина его потомков не должны превысить лимит.
   */
  async subtreeDepthTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<number> {
    const [row] = await tx.$queryRaw<Array<{ maxDepth: number | null }>>`
      WITH RECURSIVE sub AS (
        SELECT p."id", 0 AS depth
        FROM "projects" p
        WHERE p."parentId" = ${projectId} AND p."workspaceId" = ${workspaceId}
        UNION ALL
        SELECT child."id", sub.depth + 1
        FROM "projects" child
        JOIN sub ON child."parentId" = sub."id"
        WHERE child."workspaceId" = ${workspaceId} AND sub.depth < 64
      )
      SELECT MAX(depth) AS "maxDepth" FROM sub`;
    return row?.maxDepth ?? 0;
  }

  /**
   * Сериализует правки дерева в пространстве: без блокировки две встречные правки
   * (A.parent=B и B.parent=A) прошли бы проверку цикла обе и создали петлю.
   */
  async lockWorkspaceTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "workspaces" WHERE "id" = ${workspaceId} FOR UPDATE`;
  }
}
