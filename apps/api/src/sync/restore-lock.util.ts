import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * R18-01 — durable restore operation row, queried/written via raw SQL
 * (`$queryRaw`/`$executeRaw`) rather than the generated Prisma Client model
 * accessor. Deliberate: the generated client in this working tree is shared
 * with a live `pnpm dev:api` process that keeps its native query-engine
 * binary open, so `prisma generate` after adding `SyncRestoreOperation` to
 * schema.prisma cannot safely be re-run mid-session without risking that
 * process. Raw SQL against the migrated table needs no client regeneration
 * and still runs inside the caller's `withUser`/`asSystem` transaction, so
 * RLS applies exactly as it would to a generated accessor. If/when the
 * client is regenerated, this can be swapped for `tx.syncRestoreOperation.*`
 * without changing the table or the calling code's shape.
 *
 * One row per workspace (unique `workspaceId`) — this row IS the "restore in
 * progress" lock, not just a status record: acquiring it is a plain INSERT
 * that fails with a unique-violation if a restore is already in flight, and
 * releasing it is a DELETE. See the `SyncRestoreOperation` doc comment in
 * schema.prisma for the full state machine.
 */

export type RestorePhase = "staging" | "staged" | "committed";

export interface RestoreOperationRow {
  id: string;
  workspaceId: string;
  batchId: string;
  phase: RestorePhase;
  createdAt: Date;
}

/** Postgres unique_violation (23505) — surfaced by pg through Prisma's raw-query error wrapper. */
export function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("23505") || msg.includes("sync_restore_operations_workspaceId_key");
}

export async function getRestoreOperation(
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<RestoreOperationRow | null> {
  const rows = await tx.$queryRaw<RestoreOperationRow[]>`
    SELECT "id", "workspaceId", "batchId", "phase", "createdAt"
    FROM "sync_restore_operations"
    WHERE "workspaceId" = ${workspaceId}
  `;
  return rows[0] ?? null;
}

/** Acquire the lock. Throws (unique violation) if a restore is already in flight for this workspace. */
export async function insertRestoreOperationLock(
  tx: Prisma.TransactionClient,
  id: string,
  workspaceId: string,
  batchId: string
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "sync_restore_operations" ("id", "workspaceId", "batchId", "phase")
    VALUES (${id}, ${workspaceId}, ${batchId}, 'staging')
  `;
}

export async function markRestoreStaged(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "sync_restore_operations" SET "phase" = 'staged' WHERE "workspaceId" = ${workspaceId}`;
}

export async function markRestoreCommitted(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "sync_restore_operations" SET "phase" = 'committed' WHERE "workspaceId" = ${workspaceId}`;
}

export async function deleteRestoreOperation(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  await tx.$executeRaw`DELETE FROM "sync_restore_operations" WHERE "workspaceId" = ${workspaceId}`;
}

/**
 * Blocks a document/blob write while a restore is mid-flight for the
 * workspace (R18-01 acceptance: "параллельные restore и запись документа").
 * Call from any write path that touches `StorageAdapter` bytes directly
 * (DocumentsService.upload/replaceContent) — restore swaps the *entire*
 * workspace file tree out from under such a write.
 */
export async function assertNoActiveRestoreTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  const row = await getRestoreOperation(tx, workspaceId);
  if (row) {
    throw new ConflictException(
      "Для этого пространства сейчас выполняется восстановление из резервной копии — запись файлов временно недоступна"
    );
  }
}
