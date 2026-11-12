import type { Prisma } from "@prisma/client";
import {
  effectiveKnowledgeVerificationState,
  isKnowledgeVerificationOverdue,
  knowledgeOriginSchema,
  type KnowledgeCategory,
  type KnowledgeItem,
  type KnowledgeItemDetail,
  type KnowledgeLink,
  type KnowledgeOrigin,
  type KnowledgeRelation,
  type KnowledgeRevision,
  type KnowledgeSource,
  type KnowledgeVerificationState
} from "@orion/shared-types";

/**
 * Сборка DTO базы знаний (правило модуля: Prisma-модели не выходят за пределы сервиса).
 * Вынесено из `KnowledgeService`, чтобы поиск, версии и импорт отдавали ровно тот же
 * контракт, что и обычные методы списка/карточки.
 */

export interface KnowledgeSettingsValues {
  verificationDays: number;
  revisionLimit: number;
}

export type KnowledgeCategoryRow = {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeItemRow = {
  id: string;
  workspaceId: string;
  categoryId: string | null;
  projectId: string | null;
  title: string;
  summary: string;
  body: string;
  status: string;
  visibility: string;
  kind: string;
  tags: string[];
  revision: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  origin?: Prisma.JsonValue | null;
  verificationState: string;
  lastVerifiedAt?: Date | null;
  verifiedById?: string | null;
};

export type KnowledgeSourceRow = {
  id: string;
  workspaceId: string;
  itemId: string;
  type: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceAuthor: string;
  originalText: string;
  noteId: string | null;
  documentId: string | null;
  capturedAt: Date;
};

export type KnowledgeRelationRow = {
  id: string;
  workspaceId: string;
  fromId: string;
  toId: string;
  kind: string;
};

export type KnowledgeRevisionRow = {
  id: string;
  workspaceId: string;
  itemId: string;
  revision: number;
  title: string;
  summary: string;
  body: string;
  origin: Prisma.JsonValue | null;
  authorId: string;
  restoredFromId: string | null;
  createdAt: Date;
};

/** `origin` хранится как jsonb: старые/битые значения не должны ронять выдачу. */
export function toOrigin(value: Prisma.JsonValue | null | undefined): KnowledgeOrigin | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = knowledgeOriginSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parsedVerificationState(value: string): KnowledgeVerificationState {
  return value === "verified" ? "verified" : "unverified";
}

export function toCategory(row: KnowledgeCategoryRow): KnowledgeCategory {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toItem(row: KnowledgeItemRow, settings: KnowledgeSettingsValues, now: Date = new Date()): KnowledgeItem {
  const stored = parsedVerificationState(row.verificationState);
  const lastVerifiedAt = row.lastVerifiedAt ?? null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    categoryId: row.categoryId,
    projectId: row.projectId,
    title: row.title,
    summary: row.summary,
    body: row.body,
    status: row.status as KnowledgeItem["status"],
    visibility: row.visibility as KnowledgeItem["visibility"],
    kind: row.kind as KnowledgeItem["kind"],
    tags: row.tags,
    revision: row.revision,
    origin: toOrigin(row.origin),
    verificationState: effectiveKnowledgeVerificationState(stored, lastVerifiedAt, now, settings.verificationDays),
    lastVerifiedAt: lastVerifiedAt ? lastVerifiedAt.toISOString() : null,
    verifiedById: row.verifiedById ?? null,
    verificationOverdue: isKnowledgeVerificationOverdue(stored, lastVerifiedAt, now, settings.verificationDays),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toSource(row: KnowledgeSourceRow): KnowledgeSource {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    itemId: row.itemId,
    type: row.type as KnowledgeSource["type"],
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    sourceAuthor: row.sourceAuthor,
    originalText: row.originalText,
    noteId: row.noteId,
    documentId: row.documentId,
    capturedAt: row.capturedAt.toISOString()
  };
}

export function toRelation(row: KnowledgeRelationRow): KnowledgeRelation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    fromId: row.fromId,
    toId: row.toId,
    kind: row.kind as KnowledgeRelation["kind"]
  };
}

export function toLink(
  row: KnowledgeRelationRow & { to?: { id: string; title: string }; from?: { id: string; title: string } },
  peer: { id: string; title: string }
): KnowledgeLink {
  return { ...toRelation(row), peerId: peer.id, peerTitle: peer.title };
}

export function toDetail(
  row: KnowledgeItemRow & {
    sources: KnowledgeSourceRow[];
    fromRelations: Array<KnowledgeRelationRow & { to: { id: string; title: string } }>;
    toRelations: Array<KnowledgeRelationRow & { from: { id: string; title: string } }>;
  },
  settings: KnowledgeSettingsValues,
  now: Date = new Date()
): KnowledgeItemDetail {
  return {
    ...toItem(row, settings, now),
    sources: row.sources.map(toSource),
    relations: row.fromRelations.map((link) => toLink(link, link.to)),
    backlinks: row.toRelations.map((link) => toLink(link, link.from))
  };
}

export function toRevision(row: KnowledgeRevisionRow): KnowledgeRevision {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    itemId: row.itemId,
    revision: row.revision,
    title: row.title,
    summary: row.summary,
    body: row.body,
    origin: toOrigin(row.origin),
    authorId: row.authorId,
    restoredFromId: row.restoredFromId,
    createdAt: row.createdAt.toISOString()
  };
}
