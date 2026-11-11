import { z } from "zod";

/**
 * База знаний — отдельная сущность, не заметка.
 * Источник хранится отдельно от редакционного текста.
 * Публикация в Telegram и на сайт сюда не входит: это следующий слой.
 */

export const KNOWLEDGE_STATUSES = ["captured", "draft", "review", "approved", "published", "archived"] as const;
export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;

export const KNOWLEDGE_KINDS = ["method", "tool", "fact", "opinion", "link"] as const;
export const knowledgeKindSchema = z.enum(KNOWLEDGE_KINDS);
export type KnowledgeKind = z.infer<typeof knowledgeKindSchema>;

/** Сырьё и то, что ещё ждёт решения. Остальные статусы — библиотека. */
export const KNOWLEDGE_INBOX_STATUSES = ["captured", "review"] as const;

export function isKnowledgeInbox(status: KnowledgeStatus): boolean {
  return status === "captured" || status === "review";
}

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

/**
 * Происхождение материала (задание 06, п. 6.1). Пишется при импорте/маршрутизации входящего;
 * у материала, созданного руками, поля может не быть вовсе.
 */
export const knowledgeOriginSchema = z.object({
  /** Исходное имя файла (импорт документа). */
  sourceFile: z.string().optional(),
  /** Когда материал попал в базу знаний. */
  importedAt: z.string().datetime().optional(),
  /** Адрес страницы-источника. */
  sourceUrl: z.string().optional(),
  /** Автор исходного материала, если известен. */
  author: z.string().optional(),
  /** Кто импортировал (id пользователя). */
  importedBy: z.string().optional()
});
export type KnowledgeOrigin = z.infer<typeof knowledgeOriginSchema>;

export const KNOWLEDGE_VERIFICATION_STATES = ["unverified", "verified", "outdated"] as const;
export const knowledgeVerificationStateSchema = z.enum(KNOWLEDGE_VERIFICATION_STATES);
export type KnowledgeVerificationState = z.infer<typeof knowledgeVerificationStateSchema>;

/** Порог «просроченной проверки» по умолчанию — 90 дней (настройка пространства). */
export const KNOWLEDGE_DEFAULT_VERIFICATION_DAYS = 90;
/** Сколько последних версий материала хранить по умолчанию. */
export const KNOWLEDGE_DEFAULT_REVISION_LIMIT = 20;

/**
 * Состояние проверки, которое видит клиент. В базе хранится только `unverified`/`verified`;
 * `outdated` — производное: проверка была, но прошло больше порога (`verificationDays`).
 */
export function effectiveKnowledgeVerificationState(
  stored: KnowledgeVerificationState,
  lastVerifiedAt: string | Date | null,
  now: Date,
  verificationDays: number
): KnowledgeVerificationState {
  if (stored !== "verified") return stored;
  if (!lastVerifiedAt) return "unverified";
  return new Date(lastVerifiedAt).getTime() + verificationDays * 86_400_000 <= now.getTime() ? "outdated" : "verified";
}

/** Нужна ли материалу проверка: он не проверен или проверка просрочена. */
export function isKnowledgeVerificationOverdue(
  stored: KnowledgeVerificationState,
  lastVerifiedAt: string | Date | null,
  now: Date,
  verificationDays: number
): boolean {
  return effectiveKnowledgeVerificationState(stored, lastVerifiedAt, now, verificationDays) !== "verified";
}

export const knowledgeItemSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  status: knowledgeStatusSchema,
  visibility: knowledgeVisibilitySchema,
  kind: knowledgeKindSchema,
  tags: z.array(z.string()),
  revision: z.number().int(),
  origin: knowledgeOriginSchema.nullable(),
  /** Действующее состояние (включая вычисленное `outdated`), а не только хранимое в БД. */
  verificationState: knowledgeVerificationStateSchema,
  lastVerifiedAt: z.string().datetime().nullable(),
  verifiedById: z.string().nullable(),
  /** true — материалу нужна проверка (не проверен или порог прошёл). */
  verificationOverdue: z.boolean(),
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
  noteId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
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

export const knowledgeLinkSchema = knowledgeRelationSchema.extend({
  peerId: z.string().uuid(),
  peerTitle: z.string()
});
export type KnowledgeLink = z.infer<typeof knowledgeLinkSchema>;

export const knowledgeItemDetailSchema = knowledgeItemSchema.extend({
  sources: z.array(knowledgeSourceSchema),
  relations: z.array(knowledgeLinkSchema),
  backlinks: z.array(knowledgeLinkSchema)
});
export type KnowledgeItemDetail = z.infer<typeof knowledgeItemDetailSchema>;

export const createKnowledgeItemInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(4_000).optional(),
  body: z.string().max(100_000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  status: knowledgeStatusSchema.optional(),
  visibility: knowledgeVisibilitySchema.optional(),
  kind: knowledgeKindSchema.optional(),
  tags: tagsSchema.optional(),
  origin: knowledgeOriginSchema.optional()
});
export type CreateKnowledgeItemInput = z.infer<typeof createKnowledgeItemInputSchema>;

export const updateKnowledgeItemInputSchema = createKnowledgeItemInputSchema.partial().extend({
  expectedRevision: z.number().int().positive().optional()
});
export type UpdateKnowledgeItemInput = z.infer<typeof updateKnowledgeItemInputSchema>;

export const createKnowledgeSourceInputSchema = z.object({
  type: knowledgeSourceTypeSchema.optional(),
  sourceUrl: z.string().trim().max(2_000).optional(),
  sourceTitle: z.string().trim().max(300).optional(),
  sourceAuthor: z.string().trim().max(200).optional(),
  originalText: z.string().max(20_000).optional(),
  noteId: z.string().uuid().nullable().optional(),
  documentId: z.string().uuid().nullable().optional()
});
export type CreateKnowledgeSourceInput = z.infer<typeof createKnowledgeSourceInputSchema>;

export const createKnowledgeRelationInputSchema = z.object({
  toId: z.string().uuid(),
  kind: knowledgeRelationKindSchema.optional()
});
export type CreateKnowledgeRelationInput = z.infer<typeof createKnowledgeRelationInputSchema>;

/** Снимок материала (задание 06, п. 6.3). История не перезаписывается: восстановление создаёт новый снимок. */
export const knowledgeRevisionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  itemId: z.string().uuid(),
  /** Номер ревизии материала, на котором сделан снимок. */
  revision: z.number().int(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  origin: knowledgeOriginSchema.nullable(),
  /** Кто сделал снимок (пользователь). */
  authorId: z.string(),
  /** Заполнено, если снимок создан восстановлением более старой версии. */
  restoredFromId: z.string().uuid().nullable(),
  createdAt: z.string().datetime()
});
export type KnowledgeRevision = z.infer<typeof knowledgeRevisionSchema>;

/** Настройки базы знаний пространства (владелец). */
export const knowledgeSettingsSchema = z.object({
  workspaceId: z.string().uuid(),
  verificationDays: z.number().int(),
  revisionLimit: z.number().int()
});
export type KnowledgeSettings = z.infer<typeof knowledgeSettingsSchema>;

export const updateKnowledgeSettingsInputSchema = z.object({
  verificationDays: z.number().int().min(1).max(3_650).optional(),
  revisionLimit: z.number().int().min(1).max(200).optional()
});
export type UpdateKnowledgeSettingsInput = z.infer<typeof updateKnowledgeSettingsInputSchema>;

/** Параметры списка материалов: фильтры проверки и сортировка «просроченные проверки». */
export const knowledgeListQuerySchema = z.object({
  includeArchived: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
  verification: knowledgeVerificationStateSchema.optional(),
  /** true — только материалы, которым нужна проверка (не проверен или просрочен). */
  overdue: z.enum(["true", "false"]).optional(),
  /** updated — как раньше (новые сверху); verification — сначала те, чья проверка старше. */
  sort: z.enum(["updated", "verification"]).optional()
});
export type KnowledgeListQuery = z.infer<typeof knowledgeListQuerySchema>;

/** Полнотекстовый поиск по базе знаний (п. 6.2). */
export const knowledgeSearchQuerySchema = z.object({
  q: z.string().trim().min(2, "Запрос короче двух символов").max(400),
  type: knowledgeKindSchema.optional(),
  /** true — только актуально проверенные; false — все остальные (включая просроченные). */
  verified: z.enum(["true", "false"]).optional(),
  projectId: z.string().uuid().optional(),
  /** Границы по `updatedAt` (когда материал последний раз менялся). */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});
export type KnowledgeSearchQuery = z.infer<typeof knowledgeSearchQuerySchema>;

export const knowledgeSearchResultSchema = knowledgeItemSchema.extend({
  /** ts_rank: выше — релевантнее. */
  rank: z.number(),
  /** Фрагмент с подсветкой (`<b>…</b>`) для сниппета. */
  snippet: z.string()
});
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>;

/** Массовый импорт уже загруженных файлов (Documents) как самостоятельных материалов (п. 6.4). */
export const knowledgeImportDocumentsInputSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(200),
  categoryId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  status: knowledgeStatusSchema.optional(),
  kind: knowledgeKindSchema.optional()
});
export type KnowledgeImportDocumentsInput = z.infer<typeof knowledgeImportDocumentsInputSchema>;

/** Пофайловый отчёт импорта: ошибка одного файла не останавливает остальные. */
export const knowledgeImportReportItemSchema = z.object({
  documentId: z.string(),
  ok: z.boolean(),
  itemId: z.string().nullable(),
  error: z.string().nullable()
});
export type KnowledgeImportReportItem = z.infer<typeof knowledgeImportReportItemSchema>;

export const knowledgeImportReportSchema = z.object({
  okCount: z.number().int(),
  failedCount: z.number().int(),
  results: z.array(knowledgeImportReportItemSchema)
});
export type KnowledgeImportReport = z.infer<typeof knowledgeImportReportSchema>;

/** Маршрутизация записи «Входящих» в базу знаний (п. 6.4). */
export const knowledgeFromInboxInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  kind: knowledgeKindSchema.optional(),
  /** Удалить запись из входящих — отдельное подтверждение, по умолчанию запись остаётся. */
  deleteFromInbox: z.boolean().optional()
});
export type KnowledgeFromInboxInput = z.infer<typeof knowledgeFromInboxInputSchema>;

export const knowledgeFromInboxResultSchema = z.object({
  item: knowledgeItemDetailSchema,
  removedFromInbox: z.boolean()
});
export type KnowledgeFromInboxResult = z.infer<typeof knowledgeFromInboxResultSchema>;
