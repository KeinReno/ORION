import { z } from "zod";

/**
 * База знаний — отдельная сущность, не заметка.
 * Источник хранится отдельно от редакционного текста.
 * Публикация в Telegram и на сайт сюда не входит: это следующий слой.
 */

export const KNOWLEDGE_STATUSES = ["captured", "draft", "review", "approved", "published", "archived"] as const;
export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;

export const KNOWLEDGE_VISIBILITIES = ["private", "workspace"] as const;
export const knowledgeVisibilitySchema = z.enum(KNOWLEDGE_VISIBILITIES);
export type KnowledgeVisibility = z.infer<typeof knowledgeVisibilitySchema>;

export const KNOWLEDGE_SOURCE_TYPES = ["url", "note", "document", "manual", "other"] as const;
export const knowledgeSourceTypeSchema = z.enum(KNOWLEDGE_SOURCE_TYPES);
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>;

export const KNOWLEDGE_RELATION_KINDS = [
  "related",
  "expands",
  "contradicts",
  "duplicate_of",
  "derived_from",
  "part_of"
] as const;
export const knowledgeRelationKindSchema = z.enum(KNOWLEDGE_RELATION_KINDS);
export type KnowledgeRelationKind = z.infer<typeof knowledgeRelationKindSchema>;

const tagSchema = z.string().trim().min(1).max(40);
const tagsSchema = z.array(tagSchema).max(20);

export const knowledgeCategorySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type KnowledgeCategory = z.infer<typeof knowledgeCategorySchema>;

export const createKnowledgeCategoryInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional()
});
export type CreateKnowledgeCategoryInput = z.infer<typeof createKnowledgeCategoryInputSchema>;

export const updateKnowledgeCategoryInputSchema = createKnowledgeCategoryInputSchema.partial();
export type UpdateKnowledgeCategoryInput = z.infer<typeof updateKnowledgeCategoryInputSchema>;

export const knowledgeItemSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  status: knowledgeStatusSchema,
  visibility: knowledgeVisibilitySchema,
  tags: z.array(z.string()),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;

export const knowledgeSourceSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  itemId: z.string().uuid(),
  type: knowledgeSourceTypeSchema,
  sourceUrl: z.string(),
  sourceTitle: z.string(),
  sourceAuthor: z.string(),
  originalText: z.string(),
  capturedAt: z.string().datetime()
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

export const knowledgeRelationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  kind: knowledgeRelationKindSchema
});
export type KnowledgeRelation = z.infer<typeof knowledgeRelationSchema>;

export const knowledgeItemDetailSchema = knowledgeItemSchema.extend({
  sources: z.array(knowledgeSourceSchema),
  relations: z.array(knowledgeRelationSchema)
});
export type KnowledgeItemDetail = z.infer<typeof knowledgeItemDetailSchema>;

export const createKnowledgeItemInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(4_000).optional(),
  body: z.string().max(100_000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  status: knowledgeStatusSchema.optional(),
  visibility: knowledgeVisibilitySchema.optional(),
  tags: tagsSchema.optional()
});
export type CreateKnowledgeItemInput = z.infer<typeof createKnowledgeItemInputSchema>;

export const updateKnowledgeItemInputSchema = createKnowledgeItemInputSchema.partial();
export type UpdateKnowledgeItemInput = z.infer<typeof updateKnowledgeItemInputSchema>;

export const createKnowledgeSourceInputSchema = z.object({
  type: knowledgeSourceTypeSchema.optional(),
  sourceUrl: z.string().trim().max(2_000).optional(),
  sourceTitle: z.string().trim().max(300).optional(),
  sourceAuthor: z.string().trim().max(200).optional(),
  originalText: z.string().max(20_000).optional()
});
export type CreateKnowledgeSourceInput = z.infer<typeof createKnowledgeSourceInputSchema>;

export const createKnowledgeRelationInputSchema = z.object({
  toId: z.string().uuid(),
  kind: knowledgeRelationKindSchema.optional()
});
export type CreateKnowledgeRelationInput = z.infer<typeof createKnowledgeRelationInputSchema>;
