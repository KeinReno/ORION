import { z } from "zod";

/**
 * Git Workspace (задание 11.1). Read-only срез локального репозитория: сервер запускает системный `git`
 * в каталоге, который владелец заранее разрешил, и отдаёт уже разобранные данные. Здесь нет ни путей,
 * ни команд: контракт описывает только то, что клиент вправе увидеть.
 *
 * `pullRequest` всегда `null`, пока не подключён внешний провайдер (GitHub API — вне объёма задания):
 * поле остаётся в ответе, чтобы клиент не переключал форму ответа при появлении провайдера.
 */

export const developmentRepositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Канонический абсолютный путь; клиенту показывается только как подпись «где лежит». */
  path: z.string(),
  /** Префикс ссылки на задачу в сообщении коммита (`#42`); по умолчанию `#`. */
  taskRefPrefix: z.string().min(1).max(8),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type DevelopmentRepository = z.infer<typeof developmentRepositorySchema>;

export const createDevelopmentRepositoryInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  path: z.string().trim().min(1).max(4096),
  /** Префикс ссылки на задачу; по умолчанию `#`. */
  taskRefPrefix: z.string().trim().min(1).max(8).default("#")
});
export type CreateDevelopmentRepositoryInput = z.infer<typeof createDevelopmentRepositoryInputSchema>;

export const updateDevelopmentRepositoryInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    taskRefPrefix: z.string().trim().min(1).max(8).optional()
  })
  .refine((value) => value.name !== undefined || value.taskRefPrefix !== undefined, { message: "Нечего менять" });
export type UpdateDevelopmentRepositoryInput = z.infer<typeof updateDevelopmentRepositoryInputSchema>;

export const developmentGitGraphQuerySchema = z.object({
  branch: z.string().trim().min(1).max(255).optional(),
  /** Подстрока имени автора или его почты, без учёта регистра. */
  author: z.string().trim().min(1).max(160).optional(),
  /** Нижняя граница даты коммита (ISO-8601). */
  from: z.string().datetime().optional(),
  /** Верхняя граница даты коммита (ISO-8601, включительно). */
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
  /** Курсор — sha последнего коммита предыдущей страницы; сама страница начинается со следующего. */
  cursor: z.string().regex(/^[0-9a-f]{40}$/i, "Курсор — полный sha коммита").optional()
});
export type DevelopmentGitGraphQuery = z.infer<typeof developmentGitGraphQuerySchema>;

export const developmentGitCommitSchema = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  author: z.string(),
  email: z.string(),
  /** ISO-8601, авторская дата. */
  date: z.string(),
  subject: z.string(),
  /** Полное сообщение без завершающих переводов строки. */
  message: z.string(),
  isMerge: z.boolean(),
  /** Ссылки (`HEAD -> main`, `origin/main`, `tag: v1.0`) как их печатает `git log --decorate`. */
  refs: z.array(z.string())
});
export type DevelopmentGitCommit = z.infer<typeof developmentGitCommitSchema>;

export const developmentGitBranchSchema = z.object({
  name: z.string(),
  sha: z.string(),
  isCurrent: z.boolean(),
  /** Дата последнего коммита ветки, ISO-8601; `null` у пустой ветки. */
  updatedAt: z.string().nullable()
});
export type DevelopmentGitBranch = z.infer<typeof developmentGitBranchSchema>;

export const developmentGitTagSchema = z.object({
  name: z.string(),
  sha: z.string(),
  annotated: z.boolean()
});
export type DevelopmentGitTag = z.infer<typeof developmentGitTagSchema>;

export const developmentGitGraphSchema = z.object({
  repository: z.object({ id: z.string(), name: z.string(), path: z.string() }),
  head: z.string().nullable(),
  /** Текущая ветка (`null` при detached HEAD). */
  branch: z.string().nullable(),
  branches: z.array(developmentGitBranchSchema),
  tags: z.array(developmentGitTagSchema),
  commits: z.array(developmentGitCommitSchema),
  /** Коммиты слияния среди отданных — то же, что `commits[].isMerge`, отдельным списком для дерева. */
  merges: z.array(z.string()),
  /** Провайдер pull request не подключён — по контракту всегда `null`. */
  pullRequest: z.null(),
  /** История длиннее, чем сервер готов отдать (лимит `limit`/внутренний потолок). */
  truncated: z.boolean(),
  /** sha, с которого продолжить; `null` — страница последняя. */
  nextCursor: z.string().nullable(),
  /** Сколько коммитов прошло фильтры до пагинации (для честной подписи «N из M»). */
  total: z.number().int().nonnegative(),
  filters: z.object({
    branch: z.string().nullable(),
    author: z.string().nullable(),
    from: z.string().nullable(),
    to: z.string().nullable()
  })
});
export type DevelopmentGitGraph = z.infer<typeof developmentGitGraphSchema>;

export const developmentGitCompareQuerySchema = z.object({
  from: z.string().trim().min(1).max(255),
  to: z.string().trim().min(1).max(255)
});
export type DevelopmentGitCompareQuery = z.infer<typeof developmentGitCompareQuerySchema>;

export const developmentGitFileDiffSchema = z.object({
  path: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean()
});
export type DevelopmentGitFileDiff = z.infer<typeof developmentGitFileDiffSchema>;

export const developmentGitCompareSchema = z.object({
  repository: z.object({ id: z.string(), name: z.string() }),
  from: z.object({ ref: z.string(), sha: z.string() }),
  to: z.object({ ref: z.string(), sha: z.string() }),
  commits: z.array(developmentGitCommitSchema),
  files: z.array(developmentGitFileDiffSchema),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative()
});
export type DevelopmentGitCompare = z.infer<typeof developmentGitCompareSchema>;

/** `#42`, `#T-42`, `#3f2a…` — префикс настраивается владельцем пространства (по умолчанию `#`). */
export const DEVELOPMENT_TASK_REF_DEFAULT_PREFIX = "#";

/**
 * Ссылки на задачи из сообщения коммита. `ref` — то, что стоит после префикса: номер задачи в
 * пространстве (1, 2, 3…), полный uuid или его начало. Разбор не решает, существует ли задача, —
 * это делает сервер в пределах пространства (чужой номер не должен ничего связывать).
 */
export function parseCommitTaskRefs(message: string, prefix = DEVELOPMENT_TASK_REF_DEFAULT_PREFIX): string[] {
  if (!prefix) return [];
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}([A-Za-z0-9][A-Za-z0-9_-]{0,63})`, "g");
  const refs = new Set<string>();
  for (const match of message.matchAll(pattern)) {
    const ref = match[1];
    if (ref) refs.add(ref);
  }
  return [...refs];
}

export const taskCommitLinkSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  repositoryId: z.string(),
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  committedAt: z.string().datetime().nullable(),
  /** `false` — привязка найдена в сообщении коммита; `true` — поставлена человеком. */
  manual: z.boolean(),
  createdAt: z.string().datetime()
});
export type TaskCommitLink = z.infer<typeof taskCommitLinkSchema>;

export const createTaskCommitLinkInputSchema = z.object({
  repositoryId: z.string().min(1),
  sha: z.string().trim().min(1).max(120)
});
export type CreateTaskCommitLinkInput = z.infer<typeof createTaskCommitLinkInputSchema>;

export const taskTraceEntryKindSchema = z.enum(["created", "assignment", "commit", "check", "release", "status"]);
export type TaskTraceEntryKind = z.infer<typeof taskTraceEntryKindSchema>;

export const taskTraceEntrySchema = z.object({
  id: z.string(),
  kind: taskTraceEntryKindSchema,
  /** ISO-8601 или `null`, если у события нет собственной даты (например, QA-контракт). */
  at: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  /** Состояние шага, если оно есть: статус задачи, статус проверки, тег релиза. */
  status: z.string().nullable(),
  /** Ссылки на объекты ORION и коммиты; `url` — `orion://` для объектов, `null` для внешних. */
  links: z.array(z.object({ type: z.string(), id: z.string(), url: z.string().nullable() })),
  /** `true` — шаг объявлен контрактом, но исполнения пока нет (QA-v2/v3 вне ядра). */
  placeholder: z.boolean()
});
export type TaskTraceEntry = z.infer<typeof taskTraceEntrySchema>;

export const taskTraceSchema = z.object({
  workspaceId: z.string(),
  taskId: z.string(),
  title: z.string(),
  status: z.string(),
  entries: z.array(taskTraceEntrySchema),
  qa: z.object({ available: z.literal(false), reason: z.string() }),
  release: z.object({ linked: z.boolean(), tag: z.string().nullable() })
});
export type TaskTrace = z.infer<typeof taskTraceSchema>;
