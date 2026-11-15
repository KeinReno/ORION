import type {
  DevelopmentGitBranch,
  DevelopmentGitCommit,
  DevelopmentGitFileDiff,
  DevelopmentGitTag
} from "@orion/shared-types";

/**
 * Разбор вывода `git` (11.1). Отдельный чистый модуль: тесты кормят его строками в формате
 * `--pretty`, поэтому ветвление/слияния/пагинация проверяются без запуска процесса.
 *
 * Разделители выбраны так, чтобы не встречаться в тексте коммита: `\x1f` между полями и `\x1e`
 * между записями (git сам экранирует в `%B` только `%`, они безопасны).
 */
export const COMMIT_FIELD_SEPARATOR = "\x1f";
export const COMMIT_RECORD_SEPARATOR = "\x1e";
/** `sha`, `parents`, `author`, `email`, `date`, `refs`, `subject`, full message. */
export const GIT_LOG_FORMAT = `%H${COMMIT_FIELD_SEPARATOR}%P${COMMIT_FIELD_SEPARATOR}%an${COMMIT_FIELD_SEPARATOR}%ae${COMMIT_FIELD_SEPARATOR}%aI${COMMIT_FIELD_SEPARATOR}%D${COMMIT_FIELD_SEPARATOR}%s${COMMIT_FIELD_SEPARATOR}%B${COMMIT_RECORD_SEPARATOR}`;

export function parseGitLog(output: string): DevelopmentGitCommit[] {
  const commits: DevelopmentGitCommit[] = [];
  for (const record of output.split(COMMIT_RECORD_SEPARATOR)) {
    const raw = record.replace(/^\n+/, "");
    if (!raw.trim()) continue;
    const parts = raw.split(COMMIT_FIELD_SEPARATOR);
    if (parts.length < 8) continue;
    const [sha, parents, author, email, date, refs, subject, ...body] = parts;
    if (!sha || !/^[0-9a-f]{40}$/.test(sha.trim())) continue;
    const message = body.join(COMMIT_FIELD_SEPARATOR).trim();
    commits.push({
      sha: sha.trim(),
      parents: (parents ?? "").split(" ").map((parent) => parent.trim()).filter(Boolean),
      author: author ?? "",
      email: email ?? "",
      date: date ?? "",
      subject: subject ?? "",
      message: message || (subject ?? ""),
      isMerge: (parents ?? "").trim().split(" ").filter(Boolean).length > 1,
      refs: (refs ?? "")
        .split(",")
        .map((ref) => ref.trim())
        .filter(Boolean)
    });
  }
  return commits;
}

export function parseBranches(output: string): DevelopmentGitBranch[] {
  const branches: DevelopmentGitBranch[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [name, sha, date, head] = line.split(COMMIT_FIELD_SEPARATOR);
    if (!name || !sha) continue;
    branches.push({
      name,
      sha,
      isCurrent: (head ?? "").trim() === "*",
      updatedAt: date?.trim() ? date.trim() : null
    });
  }
  return branches;
}

export function parseTags(output: string): DevelopmentGitTag[] {
  const tags: DevelopmentGitTag[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [name, objectSha, objectType, peeledSha] = line.split(COMMIT_FIELD_SEPARATOR);
    if (!name) continue;
    const annotated = (objectType ?? "").trim() === "tag";
    // У аннотированного тега sha тега — цель (`*objectname`), а сам объект тега клиенту не нужен.
    const sha = annotated ? (peeledSha ?? "").trim() || (objectSha ?? "").trim() : (objectSha ?? "").trim();
    if (!sha) continue;
    tags.push({ name, sha, annotated });
  }
  return tags;
}

/** `git diff --numstat` → строки файлов; `-` в числовых колонках означает двоичный файл. */
/**
 * Формат для `parseGitLogFiles`: разделитель записи в НАЧАЛЕ — тогда сегмент содержит поля
 * коммита и его список файлов целиком (`--name-only` печатает файлы после pretty-формата).
 * Одна строка на коммит, без полного сообщения (%B).
 */
export const GIT_LOG_FILES_FORMAT = `${COMMIT_RECORD_SEPARATOR}%H${COMMIT_FIELD_SEPARATOR}%an${COMMIT_FIELD_SEPARATOR}%aI${COMMIT_FIELD_SEPARATOR}%s`;

/** Активность файла: кто и когда последним коммитил в него среди прочитанной истории. */
export interface GitFileActivity {
  sha: string;
  at: string;
  author: string;
  subject: string;
}

/**
 * Последний коммит для каждого файла из вывода `git log --name-only` в формате
 * `GIT_LOG_FILES_FORMAT`: первая строка сегмента — поля коммита, остальные — пути файлов.
 * История идёт от новых к старым, поэтому первая встреченная запись файла и есть самый
 * свежий коммит.
 */
export function parseGitLogFiles(output: string): Map<string, GitFileActivity> {
  const activity = new Map<string, GitFileActivity>();
  for (const record of output.split(COMMIT_RECORD_SEPARATOR)) {
    const lines = record.split("\n");
    const headIndex = lines.findIndex(line => line.trim());
    if (headIndex < 0) continue;
    const parts = lines[headIndex].split(COMMIT_FIELD_SEPARATOR);
    if (parts.length < 4) continue;
    const [sha, author, date, subject] = parts;
    if (!sha || !/^[0-9a-f]{40}$/u.test(sha.trim())) continue;
    const entry: GitFileActivity = { sha: sha.trim(), at: date ?? "", author: author ?? "", subject: subject ?? "" };
    for (const line of lines.slice(headIndex + 1)) {
      const filePath = line.trim();
      if (!filePath || filePath.includes("\x1f")) continue;
      if (!activity.has(filePath)) activity.set(filePath, entry);
    }
  }
  return activity;
}

export function parseNumstat(output: string): DevelopmentGitFileDiff[] {
  const files: DevelopmentGitFileDiff[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [added, deleted, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t");
    if (!filePath) continue;
    const binary = added === "-" || deleted === "-";
    files.push({
      path: filePath,
      additions: binary ? 0 : Number(added) || 0,
      deletions: binary ? 0 : Number(deleted) || 0,
      binary
    });
  }
  return files;
}

export interface GraphWindowInput {
  commits: readonly DevelopmentGitCommit[];
  limit: number;
  cursor?: string;
  author?: string;
  from?: string;
  to?: string;
}

export interface GraphWindow {
  commits: DevelopmentGitCommit[];
  total: number;
  truncated: boolean;
  nextCursor: string | null;
}

/**
 * Фильтры и пагинация по уже разобранной истории. Курсор — sha последнего отданного коммита:
 * страница начинается со СЛЕДУЮЩЕГО за ним. Неизвестный курсор — ошибка, а не молчаливая первая
 * страница (иначе клиент зациклится).
 */
export function windowCommits(input: GraphWindowInput): GraphWindow {
  const fromMs = input.from ? Date.parse(input.from) : null;
  const toMs = input.to ? Date.parse(input.to) : null;
  const author = input.author?.toLowerCase();
  const filtered = input.commits.filter((commit) => {
    if (author && !`${commit.author} ${commit.email}`.toLowerCase().includes(author)) return false;
    const at = Date.parse(commit.date);
    if (fromMs !== null && Number.isFinite(at) && at < fromMs) return false;
    if (toMs !== null && Number.isFinite(at) && at > toMs) return false;
    return true;
  });

  let start = 0;
  if (input.cursor) {
    const index = filtered.findIndex((commit) => commit.sha === input.cursor);
    if (index < 0) throw new Error("Курсор пагинации не найден в отфильтрованной истории");
    start = index + 1;
  }
  const page = filtered.slice(start, start + input.limit);
  const more = filtered.length > start + page.length;
  return {
    commits: page,
    total: filtered.length,
    truncated: more,
    nextCursor: more && page.length > 0 ? page[page.length - 1]!.sha : null
  };
}
