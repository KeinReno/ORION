import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Document as DocRow, type DocumentVersion as DocVersionRow } from "@prisma/client";
import {
  isDescendant,
  nextAvailableName,
  sanitizeSegment,
  type BulkDocumentInput,
  type CreateFolderInput,
  type DocumentItem,
  type DocumentVersion,
  type DocumentView,
  type UpdateDocumentInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { STORAGE_ADAPTER, storageKey, type StorageAdapter } from "../storage/storage-adapter";
import { assertNoActiveRestoreTx } from "../sync/restore-lock.util";

/** Uploaded file shape we rely on (subset of Express.Multer.File — avoids a @types/multer dep). */
export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Where a soft-deleted node's blob lives on the store: `<ws>/.trash/<id>`,
 * where `<id>` is the node that was trashed. `remove()` only ever trashes the
 * subtree *root*, and the panel's trash view only surfaces roots — so for any
 * node the UI lets you restore / purge / preview, `deletedAt != null` implies
 * its blob is exactly at `.trash/<id>`.
 */
const TRASH_DIR = ".trash";

/**
 * Where a file's past content snapshots live: `<ws>/.versions/<documentId>/<versionNumber>`
 * — a top-level directory, sibling to `.trash`, deliberately *not* nested
 * under the document's own path (that path always means "current content";
 * a version's bytes must survive a rename/move of the live file).
 */
const VERSIONS_DIR = ".versions";

/**
 * ORION v0.12 "Документы" — mirrors NotesService structure (withUser + RLS,
 * assertMemberTx, toDto at the bottom) with one extra concern: binary content
 * behind a StorageAdapter whose `local`/`webdav` driver mirrors this tree as a
 * real directory structure. The DB is authoritative; a blob's path is always
 * *derived* from the node's `parentId` chain, never stored.
 *
 * Storage calls that move real bytes run alongside the DB write, ordered so a
 * failure leaves an orphan blob at worst, never a row pointing at nothing.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter
  ) {}

  async list(userId: string, workspaceId: string, view: DocumentView = "active"): Promise<DocumentItem[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.document.findMany({
        where:
          view === "trash"
            ? // Only subtree roots: `remove()` trashes a whole subtree at once, so a
              // descendant's parent is deleted too — surfacing it here would let the
              // UI hand its id to restore/purge, which only know how to find a blob
              // at `.trash/<rootId>` and would fail (see TRASH_DIR's doc comment).
              { workspaceId, deletedAt: { not: null }, OR: [{ parentId: null }, { parent: { deletedAt: null } }] }
            : { workspaceId, deletedAt: null },
        // `kind` enum is declared folder-before-file, so this puts folders first.
        orderBy: [{ kind: "asc" }, { name: "asc" }]
      });
    });
    return rows.map(toDto);
  }

  async createFolder(userId: string, workspaceId: string, input: CreateFolderInput): Promise<DocumentItem> {
    const parentId = input.parentId ?? null;
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (parentId) await this.assertFolderTx(tx, workspaceId, parentId);
      const segments = await this.folderSegmentsTx(tx, parentId);
      const siblings = await tx.document.findMany({
        where: { workspaceId, parentId, deletedAt: null },
        select: { name: true }
      });
      const name = nextAvailableName(
        siblings.map((s) => s.name),
        input.name
      );
      await this.storage.mkdir(storageKey(workspaceId, ...segments, name));
      return tx.document.create({ data: { workspaceId, parentId, kind: "folder", name } });
    });
    return toDto(row);
  }

  /**
   * Multi-file upload. Membership + destination are checked in a short
   * transaction; the blobs are written *outside* it (they can be large), then
   * the rows are inserted in a second transaction — so a slow upload never
   * holds a DB transaction open.
   */
  async upload(
    userId: string,
    workspaceId: string,
    parentId: string | null,
    files: UploadedDocumentFile[]
  ): Promise<DocumentItem[]> {
    if (files.length === 0) throw new BadRequestException("Нет файлов для загрузки");

    const { segments, taken } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      // R18-01: restore() swaps the whole workspace file tree out from under
      // a write in progress — block new uploads while it's running.
      await assertNoActiveRestoreTx(tx, workspaceId);
      if (parentId) await this.assertFolderTx(tx, workspaceId, parentId);
      const segs = await this.folderSegmentsTx(tx, parentId);
      const siblings = await tx.document.findMany({
        where: { workspaceId, parentId, deletedAt: null },
        select: { name: true }
      });
      return { segments: segs, taken: siblings.map((s) => s.name) };
    });

    const prepared: Array<Pick<DocRow, "name" | "mimeType" | "sizeBytes" | "checksum" | "extractedText">> = [];
    for (const file of files) {
      const name = nextAvailableName(taken, sanitizeSegment(file.originalname || "file"));
      taken.push(name);
      const mimeType = file.mimetype && file.mimetype.length > 0 ? file.mimetype : "application/octet-stream";
      const checksum = createHash("sha256").update(file.buffer).digest("hex");
      await this.storage.putFile(storageKey(workspaceId, ...segments, name), file.buffer, { contentType: mimeType });
      prepared.push({
        name,
        mimeType,
        sizeBytes: file.buffer.length,
        checksum,
        extractedText: extractText(mimeType, file.buffer)
      });
    }

    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return Promise.all(
        prepared.map((p) =>
          tx.document.create({
            data: {
              workspaceId,
              parentId,
              kind: "file",
              name: p.name,
              mimeType: p.mimeType,
              sizeBytes: p.sizeBytes,
              checksum: p.checksum,
              extractedText: p.extractedText
            }
          })
        )
      );
    });
    return rows.map(toDto);
  }

  /** Rename (`name`), move (`parentId`) and/or re-file (`projectId`) a file or folder. */
  async update(
    userId: string,
    workspaceId: string,
    id: string,
    input: UpdateDocumentInput
  ): Promise<DocumentItem> {
    // `assertNameFreeTx`'s pre-check is a TOCTOU race by itself (two
    // concurrent moves into the same folder can both pass it before either
    // writes) — closed at the DB level by the partial unique index added in
    // migration `20260921180000_documents_name_unique`. Because the storage
    // move happens *inside* the same transaction, before the row update, a
    // move that then loses that race on `tx.document.update` (P2002) has
    // already relocated the blob on disk to `toKey` while the Postgres
    // transaction rolls the row back to `fromKey` — filesystem writes are
    // not part of the Postgres transaction and are never auto-rolled-back.
    // Left alone, the document would become unreachable (DB says `fromKey`,
    // disk has `toKey`). `moved` tracks whether that relocation happened so
    // the catch below can compensate by moving the blob back before
    // surfacing the conflict to the caller.
    let attempted: { fromKey: string; toKey: string } | null = null;
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const node = await this.assertOwnedTx(tx, workspaceId, id);
        await this.assertTrashRootTx(tx, node);

        const newParentId = input.parentId !== undefined ? input.parentId : node.parentId;
        const newName = input.name ?? node.name;
        const newProjectId = input.projectId !== undefined ? input.projectId : node.projectId;
        if (input.projectId) await this.assertProjectTx(tx, workspaceId, input.projectId);

        // A project-only change must not be swallowed by the early return the
        // name/move path uses (the contract has accepted `projectId` since
        // v0.14, but nothing ever wrote it).
        if (newParentId !== node.parentId || newName !== node.name) {
          if (newParentId) {
            if (newParentId === id) throw new BadRequestException("Нельзя переместить папку в саму себя");
            await this.assertFolderTx(tx, workspaceId, newParentId);
            const all = await tx.document.findMany({ where: { workspaceId }, select: { id: true, parentId: true } });
            if (isDescendant(all, newParentId, id)) {
              throw new BadRequestException("Нельзя переместить папку внутрь её собственной подпапки");
            }
          }

          // Two moves to the same folder and name would otherwise both pass the name check, both rename onto the
          // same path on disk (the second silently replaces the first's bytes), and the loser's compensation would
          // then carry the winner's file back to its own old path — the winner's content 500s. Serialise on the
          // destination (same case-insensitive key as the unique index): the second move waits for the first to
          // commit, then sees its row and gets a 409 before it touches the disk.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`documents:${workspaceId}:${newParentId ?? ""}:${newName.toLowerCase()}`}, 0))`;
          await this.assertNameFreeTx(tx, workspaceId, newParentId, newName, id);

          const fromKey = node.deletedAt
            ? storageKey(workspaceId, TRASH_DIR, node.id)
            : storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, node.parentId)), node.name);
          const toKey = storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, newParentId)), newName);
          if (fromKey !== toKey) {
            // Disk first: if the DB write below fails, the catch block moves
            // the blob back before the error reaches the caller. Children
            // need no DB change — their keys are derived, and `move` carried
            // the whole subtree. `attempted` is recorded *before* the await
            // settles (not only on success) — see `revertIfRelocatedTx`'s
            // doc comment for why a thrown `storage.move` doesn't rule out
            // the blob having actually relocated (network storage drivers
            // can report failure after the server-side op already landed).
            attempted = { fromKey, toKey };
            await this.storage.move(fromKey, toKey);
          }
        }

        return tx.document.update({
          where: { id },
          data: { parentId: newParentId, name: newName, projectId: newProjectId }
        });
      });
      return toDto(row);
    } catch (error) {
      await this.revertIfRelocated(attempted, "update", id);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("В этой папке уже есть элемент с таким именем");
      }
      throw error;
    }
  }

  /**
   * Soft delete — moves the node (and any subtree) to the trash.
   *
   * Same TOCTOU shape as `update`'s move (see the comment there): the blob
   * move happens *inside* the transaction, before the row write, so a
   * failure that lands after `storage.move` is called but before the
   * transaction commits (a DB hiccup, a killed process, or the move call
   * itself reporting failure *after* it actually relocated the blob — see
   * `revertIfRelocated`'s doc comment) leaves the blob already relocated to
   * `.trash/<id>` while Postgres rolls the row back to `deletedAt: null` — a
   * document that looks live but whose content 404s. `attempted` records the
   * keys before the move settles so the catch block can compensate before
   * the error reaches the caller, exactly like `update`.
   */
  async remove(userId: string, workspaceId: string, id: string): Promise<void> {
    let attempted: { fromKey: string; toKey: string } | null = null;
    try {
      await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const node = await this.assertOwnedTx(tx, workspaceId, id);
        if (node.deletedAt) return;
        const subtreeIds = await this.collectSubtreeIdsTx(tx, id);
        const fromKey = storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, node.parentId)), node.name);
        const toKey = storageKey(workspaceId, TRASH_DIR, node.id);
        attempted = { fromKey, toKey };
        await this.storage.move(fromKey, toKey);
        await tx.document.updateMany({ where: { id: { in: subtreeIds } }, data: { deletedAt: new Date() } });
      });
    } catch (error) {
      await this.revertIfRelocated(attempted, "remove", id);
      throw error;
    }
  }

  /**
   * Restore from trash. Same compensation shape as `remove`/`update`: the
   * blob leaves `.trash/<id>` before the row's `deletedAt` is cleared, so a
   * failure landing after the move but before commit would otherwise leave
   * the row still marked trashed while its blob has already left the trash
   * key — the trash view's own restore/purge path would then 404.
   * `attempted` lets the catch block put the blob back at `.trash/<id>` on
   * any failure.
   */
  async restore(userId: string, workspaceId: string, id: string): Promise<DocumentItem> {
    let attempted: { fromKey: string; toKey: string } | null = null;
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const node = await this.assertOwnedTx(tx, workspaceId, id);
        await this.assertTrashRootTx(tx, node);
        const subtreeIds = await this.collectSubtreeIdsTx(tx, id);

        // Restore under the original parent only if it's still a live folder;
        // otherwise drop the node back at the workspace root.
        let destParentId: string | null = null;
        if (node.parentId) {
          const parent = await tx.document.findUnique({ where: { id: node.parentId } });
          if (parent && parent.workspaceId === workspaceId && !parent.deletedAt && parent.kind === "folder") {
            destParentId = node.parentId;
          }
        }
        const siblings = await tx.document.findMany({
          where: { workspaceId, parentId: destParentId, deletedAt: null },
          select: { name: true }
        });
        const name = nextAvailableName(
          siblings.map((s) => s.name),
          node.name
        );

        const fromKey = storageKey(workspaceId, TRASH_DIR, node.id);
        const toKey = storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, destParentId)), name);
        attempted = { fromKey, toKey };
        await this.storage.move(fromKey, toKey);

        const updated = await tx.document.update({
          where: { id },
          data: { deletedAt: null, parentId: destParentId, name }
        });
        const rest = subtreeIds.filter((x) => x !== id);
        if (rest.length > 0) {
          await tx.document.updateMany({ where: { id: { in: rest } }, data: { deletedAt: null } });
        }
        return updated;
      });
      return toDto(row);
    } catch (error) {
      await this.revertIfRelocated(attempted, "restore", id);
      throw error;
    }
  }

  /**
   * Shared compensation for `update`/`remove`/`restore`: on any failure
   * after a `storage.move(fromKey, toKey)` was attempted, put the blob back
   * at `fromKey` — but only if it's actually sitting at `toKey` and not at
   * `fromKey`. The naive version of this (unconditionally reverting because
   * `storage.move` *resolved*) misses a real fault class: a network storage
   * driver (WebDAV) can complete the server-side move and then still throw
   * from the client call (timeout/dropped connection reading the response),
   * so `storage.move`'s promise *rejecting* does not prove the blob never
   * relocated. Probing both keys makes the compensation correct whether the
   * move threw or a later step in the transaction did, and makes it a no-op
   * (not a loud false-positive error) when the move genuinely never
   * happened.
   */
  private async revertIfRelocated(
    attempted: { fromKey: string; toKey: string } | null,
    op: "update" | "remove" | "restore",
    id: string
  ): Promise<void> {
    if (!attempted) return;
    const { fromKey, toKey } = attempted;
    try {
      const relocated = (await this.storage.exists(toKey)) && !(await this.storage.exists(fromKey));
      if (relocated) await this.storage.move(toKey, fromKey);
    } catch (revertError) {
      // Best-effort: if this also fails, the document is left inaccessible
      // under either key — log loudly rather than silently reporting the
      // original error as if disk state were untouched.
      console.error(
        `documents.${op}: failed to revert blob move ${toKey} -> ${fromKey} after a failed operation on document ${id}; the file may be orphaned on disk`,
        revertError
      );
    }
  }

  /**
   * Shared compensation for `replaceContent`/`restoreVersion`: on any
   * failure after a destructive overwrite of the live key was attempted,
   * copy `backupKey` (the archive `archiveContentTx` made of what was live
   * *before* the overwrite) back over `liveKey`. Unlike `revertIfRelocated`
   * (which probes which key the blob is actually at, since a move either
   * happened or didn't), this is unconditional: `backupKey` always holds the
   * correct pre-write bytes once `attempted` is set, so re-copying it over
   * `liveKey` is correct whether the overwrite never ran, partially ran, or
   * fully landed before the surrounding transaction failed.
   */
  private async revertContentIfWritten(
    attempted: { liveKey: string; backupKey: string } | null,
    op: "replaceContent" | "restoreVersion",
    id: string
  ): Promise<void> {
    if (!attempted) return;
    const { liveKey, backupKey } = attempted;
    try {
      await this.storage.copy(backupKey, liveKey);
    } catch (revertError) {
      // Best-effort: if this also fails, the live key may now hold content
      // that doesn't match the (rolled-back) DB row — log loudly rather than
      // silently reporting the original error as if disk state were untouched.
      console.error(
        `documents.${op}: failed to restore original content at ${liveKey} from backup ${backupKey} after a failed operation on document ${id}; live content may no longer match its DB metadata`,
        revertError
      );
    }
  }

  /** Irreversible hard delete (recursive) + blob removal. */
  async purge(userId: string, workspaceId: string, id: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const node = await this.assertOwnedTx(tx, workspaceId, id);
      await this.assertTrashRootTx(tx, node);
      const subtreeIds = await this.collectSubtreeIdsTx(tx, id);
      const key = node.deletedAt
        ? storageKey(workspaceId, TRASH_DIR, node.id)
        : storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, node.parentId)), node.name);
      // Row(s) first (cascade drops the subtree, incl. every DocumentVersion),
      // then the blobs — a leftover blob is harmless, a row with no blob is
      // not. Version blobs live under `.versions/<id>` — a separate tree from
      // the live/trash blob, one per node in the subtree, so each is removed
      // individually rather than folded into the single `key` above.
      await tx.document.delete({ where: { id } });
      await this.storage.remove(key);
      for (const subId of subtreeIds) {
        await this.storage.remove(storageKey(workspaceId, VERSIONS_DIR, subId));
      }
    });
  }

  /**
   * Overwrites a file's content. Whatever was live gets archived as a new
   * version first — every replace snapshots what it replaces, so nothing
   * uploaded is ever lost, only superseded (see `restoreVersion`).
   *
   * Unlike `update`/`remove`/`restore` (which *move* a blob and can always
   * move it back), this write is destructive: `storage.putFile` overwrites
   * the live key in place. A failure landing after the write physically
   * completes but before the wrapping transaction commits (same "server op
   * landed, client throws" fault class as the WebDAV move case — see
   * `revertIfRelocated`'s doc comment) would otherwise leave the live blob
   * holding the *new* bytes while the DB row still describes the *old* ones.
   * `archiveContentTx`'s return value (the archive copy it just made, before
   * this overwrite) is exactly the content to restore, so `attempted` is
   * captured right before the overwrite and any failure after that point
   * copies it back over the live key (`revertContentIfWritten`).
   */
  async replaceContent(
    userId: string,
    workspaceId: string,
    id: string,
    file: UploadedDocumentFile
  ): Promise<DocumentItem> {
    let attempted: { liveKey: string; backupKey: string } | null = null;
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        // R18-01: restore() swaps the whole workspace file tree out from
        // under a write in progress — block content replacement while it's
        // running.
        await assertNoActiveRestoreTx(tx, workspaceId);
        const node = await this.assertOwnedTx(tx, workspaceId, id);
        if (node.kind !== "file") throw new BadRequestException("Это папка, а не файл");
        if (node.deletedAt) throw new BadRequestException("Файл в корзине — сначала восстановите его");

        const liveKey = storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, node.parentId)), node.name);
        const backupKey = await this.archiveContentTx(tx, workspaceId, node, liveKey);

        const mimeType = file.mimetype && file.mimetype.length > 0 ? file.mimetype : "application/octet-stream";
        const checksum = createHash("sha256").update(file.buffer).digest("hex");
        attempted = { liveKey, backupKey };
        await this.storage.putFile(liveKey, file.buffer, { contentType: mimeType });

        return tx.document.update({
          where: { id },
          data: {
            mimeType,
            sizeBytes: file.buffer.length,
            checksum,
            extractedText: extractText(mimeType, file.buffer)
          }
        });
      });
      return toDto(row);
    } catch (error) {
      await this.revertContentIfWritten(attempted, "replaceContent", id);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Версия уже создаётся, повторите замену");
      }
      throw error;
    }
  }

  /** Version history for a file, newest first — no bytes, just metadata (see `getVersionContent`). */
  async listVersions(userId: string, workspaceId: string, id: string): Promise<DocumentVersion[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, id);
      const rows = await tx.documentVersion.findMany({
        where: { documentId: id },
        orderBy: { versionNumber: "desc" },
        take: 200
      });
      return rows.map(toVersionDto);
    });
  }

  /** Auth + range parsing for `GET .../:id/versions/:versionId/content` — mirrors `openContent`. */
  async getVersionContent(
    userId: string,
    workspaceId: string,
    id: string,
    versionId: string,
    rangeHeader?: string
  ): Promise<{ stream: Readable; mime: string; size: number; range: { start: number; end: number } | null }> {
    const version = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, id);
      const row = await tx.documentVersion.findUnique({ where: { id: versionId } });
      if (!row || row.documentId !== id) throw new NotFoundException("Версия не найдена");
      return row;
    });
    const range = parseRange(rangeHeader, version.sizeBytes);
    const stream = await this.storage.getStream(version.storageKey, range ?? undefined);
    return { stream, mime: version.mimeType ?? "application/octet-stream", size: version.sizeBytes, range };
  }

  /**
   * Rolls a file back to `versionId`'s content. Always archives the current
   * content first (unconditionally, like `restoreRevision` in NotesService)
   * — a restore is itself undoable.
   */
  async restoreVersion(userId: string, workspaceId: string, id: string, versionId: string): Promise<DocumentItem> {
    // Same destructive-overwrite fault class as `replaceContent` (see its
    // doc comment): `storage.copy(version.storageKey, liveKey)` overwrites
    // the live blob in place, so `attempted` records the archive copy
    // `archiveContentTx` just made (the content that was live *before* this
    // restore) so a failure after the copy lands can be reverted to it.
    let attempted: { liveKey: string; backupKey: string } | null = null;
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const node = await this.assertOwnedTx(tx, workspaceId, id);
        if (node.kind !== "file") throw new BadRequestException("Это папка, а не файл");
        if (node.deletedAt) throw new BadRequestException("Файл в корзине — сначала восстановите его");
        const version = await tx.documentVersion.findUnique({ where: { id: versionId } });
        if (!version || version.documentId !== id) throw new NotFoundException("Версия не найдена");

        const liveKey = storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, node.parentId)), node.name);
        const backupKey = await this.archiveContentTx(tx, workspaceId, node, liveKey);
        attempted = { liveKey, backupKey };
        await this.storage.copy(version.storageKey, liveKey);

        const mimeType = version.mimeType ?? node.mimeType;
        const extractedText =
          mimeType && TEXTUAL_MIME.test(mimeType)
            ? extractText(mimeType, await streamToBuffer(await this.storage.getStream(version.storageKey)))
            : "";

        return tx.document.update({
          where: { id },
          data: { mimeType, sizeBytes: version.sizeBytes, checksum: version.checksum, extractedText }
        });
      });
      return toDto(row);
    } catch (error) {
      await this.revertContentIfWritten(attempted, "restoreVersion", id);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Версия уже создаётся, повторите восстановление");
      }
      throw error;
    }
  }

  /**
   * Applies one op to many ids. Ids whose ancestor is also in the batch are
   * skipped (the ancestor's op already covers them). Each id runs through the
   * matching single-item method; failures are collected and, if every id
   * failed, the first error is rethrown.
   */
  async bulk(userId: string, workspaceId: string, input: BulkDocumentInput): Promise<void> {
    const tree = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.document.findMany({ where: { workspaceId }, select: { id: true, parentId: true } });
    });
    const batch = new Set(input.ids);
    const targets = input.ids.filter((id) => !input.ids.some((other) => other !== id && isDescendant(tree, id, other) && batch.has(other)));

    const errors: unknown[] = [];
    for (const id of targets) {
      try {
        if (input.op === "move") {
          await this.update(userId, workspaceId, id, { parentId: input.parentId ?? null });
        } else if (input.op === "trash") {
          await this.remove(userId, workspaceId, id);
        } else if (input.op === "restore") {
          await this.restore(userId, workspaceId, id);
        } else {
          await this.purge(userId, workspaceId, id);
        }
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0 && errors.length === targets.length) throw errors[0];
  }

  /**
   * Auth + range parsing for `GET .../:id/content`. Returns everything the
   * controller needs to set headers and pipe the body.
   */
  async openContent(
    userId: string,
    workspaceId: string,
    id: string,
    rangeHeader?: string
  ): Promise<{ stream: Readable; mime: string; size: number; name: string; range: { start: number; end: number } | null }> {
    const meta = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const node = await this.assertOwnedTx(tx, workspaceId, id);
      await this.assertTrashRootTx(tx, node);
      if (node.kind !== "file") throw new BadRequestException("Это папка, а не файл");
      const key = node.deletedAt
        ? storageKey(workspaceId, TRASH_DIR, node.id)
        : storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, node.parentId)), node.name);
      return { key, mime: node.mimeType ?? "application/octet-stream", size: node.sizeBytes ?? 0, name: node.name };
    });

    const range = parseRange(rangeHeader, meta.size);
    const stream = await this.storage.getStream(meta.key, range ?? undefined);
    return { stream, mime: meta.mime, size: meta.size, name: meta.name, range };
  }

  /**
   * U09 — content stream for a document reached through an already-verified
   * `CrossWorkspaceGrant` (see `SharedService.getDocumentContent`, the only
   * caller). The grant's own check already decided access; this method does
   * NOT repeat that decision and does NOT call `assertMemberTx` — the caller
   * is deliberately not a workspace member at all.
   *
   * It resolves the on-disk key with `asSystem`, not `withUser`: the
   * grant-read RLS policy only makes the single granted `Document` row
   * visible, not its folder ancestors, so the ordinary `folderSegmentsTx`
   * walk (which needs to read each parent folder row) would see nothing
   * under a grant-scoped transaction. `asSystem` here is the same narrow,
   * audited bypass pattern `SharedGrantsService.listMine` already uses for
   * resolving a source workspace's name — access was already authorized
   * before this call, only the physical path lookup needs the bypass.
   */
  async openContentForGrant(
    workspaceId: string,
    documentId: string,
    rangeHeader?: string
  ): Promise<{ stream: Readable; mime: string; size: number; name: string; range: { start: number; end: number } | null } | null> {
    const meta = await this.prisma.asSystem(async (tx) => {
      const node = await tx.document.findUnique({ where: { id: documentId } });
      if (!node || node.workspaceId !== workspaceId || node.kind !== "file" || node.deletedAt) return null;
      const key = storageKey(workspaceId, ...(await this.folderSegmentsTx(tx, node.parentId)), node.name);
      return { key, mime: node.mimeType ?? "application/octet-stream", size: node.sizeBytes ?? 0, name: node.name };
    });
    if (!meta) return null;

    const range = parseRange(rangeHeader, meta.size);
    const stream = await this.storage.getStream(meta.key, range ?? undefined);
    return { stream, mime: meta.mime, size: meta.size, name: meta.name, range };
  }

  // --- helpers -------------------------------------------------------------

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<DocRow> {
    const node = await tx.document.findUnique({ where: { id } });
    if (!node || node.workspaceId !== workspaceId) throw new NotFoundException("Документ не найден");
    return node;
  }

  /**
   * A trashed node only has a blob at `.trash/<id>` if it's the subtree
   * *root* `remove()` was called on — descendants share that one blob
   * nested inside it (see TRASH_DIR's doc comment). `list("trash")` only
   * ever surfaces roots, but restore/purge/update are reachable by id
   * directly (bulk ops, stale client state), so re-check here rather than
   * let `storage.move`/`storage.remove` fail on a path that was never
   * created.
   */
  private async assertTrashRootTx(tx: Prisma.TransactionClient, node: DocRow): Promise<void> {
    if (!node.deletedAt || !node.parentId) return;
    const parent = await tx.document.findUnique({ where: { id: node.parentId }, select: { deletedAt: true } });
    if (parent?.deletedAt) {
      throw new BadRequestException("Это вложенный элемент корзины — восстановите или удалите родительскую папку целиком");
    }
  }

  private async assertFolderTx(tx: Prisma.TransactionClient, workspaceId: string, folderId: string): Promise<void> {
    const folder = await tx.document.findUnique({ where: { id: folderId } });
    if (!folder || folder.workspaceId !== workspaceId || folder.deletedAt) {
      throw new NotFoundException("Папка не найдена");
    }
    if (folder.kind !== "folder") throw new BadRequestException("Это не папка");
  }

  /**
   * A project link must resolve to a project *of this workspace* — the same
   * guard notes/tasks/events/inbox use (`assertProjectTx`), so a user who is a
   * member of two workspaces can't file a document into the other one's project.
   */
  private async assertProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<void> {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new NotFoundException("Проект не найден");
    }
  }

  private async assertNameFreeTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    parentId: string | null,
    name: string,
    exceptId: string
  ): Promise<void> {
    const clash = await tx.document.findFirst({
      where: {
        workspaceId,
        parentId,
        deletedAt: null,
        id: { not: exceptId },
        name: { equals: name, mode: "insensitive" }
      },
      select: { id: true }
    });
    if (clash) throw new ConflictException("В этой папке уже есть элемент с таким именем");
  }

  /**
   * Snapshots `node`'s current content (at `liveKey`) into `document_versions`
   * — shared by `replaceContent` (before overwriting) and `restoreVersion`
   * (before rolling back), so both always leave an undo trail. The next
   * `versionNumber` is `max(existing) + 1`; a race between two concurrent
   * replaces of the same document lands on the `@@unique([documentId,
   * versionNumber])` index and surfaces as P2002 to the caller.
   *
   * Returns the archive's `versionKey`: the blob copy this just made is a
   * ready-made restore point for the destructive overwrite that follows it
   * in both callers, so they capture it as their own compensation's
   * `backupKey` (see `revertContentIfWritten`). The copy lands on disk
   * before the `documentVersion` row commits, so it stays a valid restore
   * point even if the surrounding transaction later rolls that row back.
   */
  private async archiveContentTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    node: DocRow,
    liveKey: string
  ): Promise<string> {
    const last = await tx.documentVersion.findFirst({
      where: { documentId: node.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true }
    });
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    const versionKey = storageKey(workspaceId, VERSIONS_DIR, node.id, String(versionNumber));
    await this.storage.copy(liveKey, versionKey);
    await tx.documentVersion.create({
      data: {
        workspaceId,
        documentId: node.id,
        versionNumber,
        storageKey: versionKey,
        sizeBytes: node.sizeBytes ?? 0,
        checksum: node.checksum ?? "",
        mimeType: node.mimeType
      }
    });
    return versionKey;
  }

  /** Names of the folders from the workspace root down to `parentId` (inclusive). */
  private async folderSegmentsTx(tx: Prisma.TransactionClient, parentId: string | null): Promise<string[]> {
    const segments: string[] = [];
    const seen = new Set<string>();
    let current = parentId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = await tx.document.findUnique({ where: { id: current }, select: { name: true, parentId: true } });
      if (!folder) break;
      segments.unshift(folder.name);
      current = folder.parentId;
    }
    return segments;
  }

  /** `rootId` plus every descendant, via a recursive CTE (parentId is intact through soft-delete). */
  private async collectSubtreeIdsTx(tx: Prisma.TransactionClient, rootId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE sub AS (
        SELECT id FROM "documents" WHERE id = ${rootId}
        UNION ALL
        SELECT d.id FROM "documents" d JOIN sub ON d."parentId" = sub.id
      )
      SELECT id FROM sub
    `;
    return rows.map((r) => r.id);
  }
}

/**
 * Bytes of extracted text kept per file. A cap keeps a runaway log file from
 * bloating the row (and every global-search scan) without needing a trigger.
 */
const MAX_EXTRACTED_TEXT = 200_000;

/** MIME types whose bytes *are* text — the only ones we can index by content. */
const TEXTUAL_MIME = /^text\/|^application\/(json|xml|yaml|x-yaml|javascript|typescript|sql)$|\+json$|\+xml$|^image\/svg\+xml$/;

/**
 * Plain-text extraction for the global search (v0.14). Until now
 * `Document.extractedText` existed in the schema and was read by
 * SearchService, but nothing ever wrote it — so documents were findable by
 * name only, and `matchedText` came back empty.
 *
 * Deliberately limited to formats that need no parser: PDF/Word/Excel would
 * mean pulling pdfjs/mammoth/xlsx into the API as well, while the *client*
 * already renders them lazily. Those files stay searchable by name.
 */
function extractText(mimeType: string, buffer: Buffer): string {
  if (!TEXTUAL_MIME.test(mimeType)) return "";
  return buffer.subarray(0, MAX_EXTRACTED_TEXT).toString("utf8");
}

/** `bytes=0-99` / `bytes=100-` / `bytes=-500` → clamped {start,end}, or null if absent/unsatisfiable. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {  if (!header || !header.startsWith("bytes=") || size <= 0) return null;
  const spec = header.slice(6).split(",")[0]?.trim() ?? "";
  const dash = spec.indexOf("-");
  if (dash < 0) return null;
  const startRaw = spec.slice(0, dash).trim();
  const endRaw = spec.slice(dash + 1).trim();
  let start: number;
  let end: number;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Number(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    end = Math.min(end, size - 1);
  }
  if (start > end || start < 0) return null;
  return { start, end };
}

function toDto(d: DocRow): DocumentItem {
  return {
    id: d.id,
    workspaceId: d.workspaceId,
    projectId: d.projectId,
    parentId: d.parentId,
    kind: d.kind,
    name: d.name,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    checksum: d.checksum,
    extractedText: d.extractedText,
    deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString()
  };
}

/** `storageKey` is internal (never handed to the client, same as `Document`'s derived blob path). */
function toVersionDto(v: DocVersionRow): DocumentVersion {
  return {
    id: v.id,
    documentId: v.documentId,
    versionNumber: v.versionNumber,
    sizeBytes: v.sizeBytes,
    checksum: v.checksum,
    mimeType: v.mimeType,
    createdAt: v.createdAt.toISOString()
  };
}

/** Drains a Readable into a Buffer — only used for the (usually small) textual files re-extracted on restore. */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
