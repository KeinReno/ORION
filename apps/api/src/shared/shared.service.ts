import type { Readable } from "node:stream";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { SharedObjectView } from "@orion/shared-types";
import { GrantNotActiveError, PrismaService } from "../common/prisma.service";
import { DocumentsService } from "../documents/documents.service";

/**
 * U09 — the ONLY caller of `PrismaService.withGrant` in the codebase. Every
 * read here goes through the grant-scoped transaction, never `withUser`
 * directly on the target table: `withGrant` is what sets
 * `app.active_grant_id`, which is what makes the `*_grant_read` RLS
 * policies (see the `cross_workspace_grants_rls` migration) return
 * anything at all for a non-member.
 *
 * Allowlist per type (раздел 3.1 of the threat model doc) is applied here,
 * by hand, field by field — never a raw Prisma object, never the same
 * `toDto` a workspace member sees (that DTO can carry fields not meant for
 * a grantee, e.g. a note attachment list or a project's finance rollup).
 * No FK/EntityLink traversal happens anywhere in this file (T1).
 */
@Injectable()
export class SharedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService
  ) {}

  async getObject(userId: string, grantId: string): Promise<SharedObjectView> {
    let result: SharedObjectView | null;
    try {
      // R29-01: `withGrant` now throws GrantNotActiveError and never calls
      // this callback at all when the grant is missing/foreign/expired/
      // revoked — it no longer relies on "queries below happen to return
      // nothing" (an ordinary membership policy on the target table can
      // make them return something, e.g. a grantee who is also a plain
      // workspace member). The grant handed in here is already verified.
      result = await this.prisma.withGrant(grantId, userId, async (tx, grant) => {
      switch (grant.objectType) {
        case "note": {
          // R29-03: a trashed note (soft-deleted, deletedAt set) must not
          // stay readable through an otherwise-active grant — trashing is a
          // meaningful access change the owner made, not a no-op the shared
          // path should ignore. findFirst + explicit deletedAt: null filter
          // (findUnique can't take a non-unique extra predicate here).
          const row = await tx.note.findFirst({
            where: { id: grant.objectId, deletedAt: null },
            select: { id: true, title: true, body: true, tags: true }
          });
          if (!row) return null;
          return { objectType: "note" as const, grantId, title: row.title, body: row.body, tags: row.tags };
        }
        case "document": {
          const row = await tx.document.findFirst({
            where: { id: grant.objectId, deletedAt: null },
            select: { id: true, name: true, mimeType: true, sizeBytes: true, kind: true }
          });
          if (!row || row.kind !== "file") return null;
          return { objectType: "document" as const, grantId, name: row.name, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
        }
        case "project": {
          const row = await tx.project.findUnique({
            where: { id: grant.objectId },
            select: { id: true, name: true, description: true, status: true, startAt: true, dueAt: true }
          });
          if (!row) return null;
          return {
            objectType: "project" as const,
            grantId,
            name: row.name,
            description: row.description,
            status: row.status,
            startAt: row.startAt ? row.startAt.toISOString() : null,
            dueAt: row.dueAt ? row.dueAt.toISOString() : null
          };
        }
        case "transaction": {
          const row = await tx.transaction.findUnique({
            where: { id: grant.objectId },
            select: { id: true, type: true, note: true, occurredAt: true }
          });
          if (!row) return null;
          return { objectType: "transaction" as const, grantId, type: row.type, note: row.note, occurredAt: row.occurredAt.toISOString() };
        }
        default:
          return null;
      }
      });
    } catch (err) {
      if (err instanceof GrantNotActiveError) {
        // Same 404 as "object not found" below — covers "grant exists but
        // is revoked/expired/not yours" (T2 — revoke must take effect on
        // the very next read) as well as "grantId never existed", and now
        // also "caller is a workspace member/owner but not this grant's
        // grantee" (R29-01's second finding: the shared path is a
        // grantee-only channel, not "anyone who happens to have access").
        throw new NotFoundException("Доступ по этой ссылке недоступен");
      }
      throw err;
    }

    if (!result) {
      // "Grant active but target row itself is gone" (deleted/trashed) —
      // same uniform 404.
      throw new NotFoundException("Доступ по этой ссылке недоступен");
    }
    return result;
  }

  /**
   * `GET /shared/:grantId/content` — file bytes for a `document`-type grant.
   * `getObject` above deliberately only returns metadata (name/mimeType/
   * sizeBytes); this is the separate stream path, mirroring the ordinary
   * `GET workspaces/:id/documents/:docId/content` split between DTO reads
   * and byte streaming. Same "whole file, no partial-byte-range restriction
   * beyond ordinary HTTP Range" principle as the member-facing download —
   * the threat model's explicit document warning (раздел 3.1) already told
   * the owner this before the grant was created; this endpoint doesn't add
   * a second, narrower gate on top of that decision.
   */
  async getDocumentContent(
    userId: string,
    grantId: string,
    rangeHeader?: string
  ): Promise<{ stream: Readable; mime: string; size: number; name: string; range: { start: number; end: number } | null }> {
    let result: { workspaceId: string; objectId: string } | null;
    try {
      result = await this.prisma.withGrant(grantId, userId, async (tx, grant) => {
        if (grant.objectType !== "document") return null;
        // Confirms the grant-read RLS policy actually unlocked this exact
        // row in this transaction (T2/T4) — not just that a grant record
        // exists.
        const visible = await tx.document.findFirst({ where: { id: grant.objectId, deletedAt: null }, select: { id: true } });
        if (!visible) return null;
        return { workspaceId: grant.workspaceId, objectId: grant.objectId };
      });
    } catch (err) {
      if (err instanceof GrantNotActiveError) {
        throw new NotFoundException("Доступ по этой ссылке недоступен");
      }
      throw err;
    }
    if (!result) throw new NotFoundException("Доступ по этой ссылке недоступен");

    const content = await this.documents.openContentForGrant(result.workspaceId, result.objectId, rangeHeader);
    if (!content) throw new NotFoundException("Доступ по этой ссылке недоступен");
    return content;
  }
}
