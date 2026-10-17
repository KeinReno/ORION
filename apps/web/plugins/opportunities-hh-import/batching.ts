import { classifyHhPath, type HhExtraction } from "@orion/shared-types";
import { extractDocumentText, type DocumentInput, type ExtractionDeps } from "./document-text";

/**
 * Большой пакет HH режется на части ДО отправки: каждая часть — отдельный предпросмотр (ImportRun) в пределах
 * серверных ограничений (≤250 файлов, ≤500 000 символов JSON). Файлы читаются и извлекаются по одному и не
 * хранятся целиком в памяти: после отправки части её тексты отбрасываются.
 * Повторное применение безопасно: сервер дедуплицирует по стабильным ключам, поэтому прерванный пакет
 * можно выбрать заново — уже сохранённое не задвоится.
 */

export const PACKAGE_LIMITS = {
  maxFiles: 10000,
  maxTotalBytes: 100 * 1024 * 1024,
  partFiles: 200,
  partChars: 380000,
  maxFileChars: 200000,
  maxJsonBytes: 800000
} as const;

export interface PickedFile extends Omit<DocumentInput, "name"> { path: string }
export interface PreviewFile { path: string; text: string; extraction?: HhExtraction }
export interface PackageIssue { path: string; reason: string; code: string }
export interface PackagePart { files: PreviewFile[]; issues: PackageIssue[]; processed: number }

export const SUPPORTED_KINDS = ["resume", "vacancy", "history"];

/** Проверка размера пакета ДО чтения: превышение объясняется сразу, а не после загрузки. */
export function checkPackageSize(files: { size: number }[]): string | null {
  if (files.length > PACKAGE_LIMITS.maxFiles) return `Поддерживаемых файлов ${files.length}: больше ${PACKAGE_LIMITS.maxFiles}. Разделите пакет на папки.`;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > PACKAGE_LIMITS.maxTotalBytes) return `Пакет ${(total / 1024 / 1024).toFixed(1)} МБ: больше ${PACKAGE_LIMITS.maxTotalBytes / 1024 / 1024} МБ. Разделите пакет на папки.`;
  return null;
}

/**
 * Читает файлы по очереди и отдаёт части. Не-ok извлечения отправляются на сервер с метаданными (текст пуст),
 * чтобы отчёт предпросмотра был единственным источником правды о пропусках; локально отсекается только то, что
 * сервер физически не примет (слишком большой JSON).
 */
export async function* buildParts(files: PickedFile[], deps: ExtractionDeps, shouldStop: () => boolean = () => false): AsyncGenerator<PackagePart> {
  let part: PreviewFile[] = []; let issues: PackageIssue[] = []; let chars = 0; let processed = 0;
  const flush = (): PackagePart | null => {
    if (!part.length && !issues.length) return null;
    const result = { files: part, issues, processed }; part = []; issues = []; chars = 0; return result;
  };
  for (const file of files) {
    if (shouldStop()) break;
    processed += 1;
    const kind = classifyHhPath(file.path);
    let entry: PreviewFile;
    if (/\.json$/i.test(file.path)) {
      if (kind === "excluded" || kind === "unsupported") continue;
      if (file.size > PACKAGE_LIMITS.maxJsonBytes) { issues.push({ path: file.path, reason: "JSON больше 800 КБ — разбейте файл на части", code: "too_large" }); continue; }
      const text = await file.text();
      if (text.length > PACKAGE_LIMITS.maxFileChars) { issues.push({ path: file.path, reason: "JSON длиннее 200 000 символов — разбейте файл на части", code: "too_large" }); continue; }
      entry = { path: file.path, text };
    } else {
      let result;
      try { result = await extractDocumentText({ name: file.path, size: file.size, bytes: () => file.bytes(), text: () => file.text() }, deps); }
      catch { result = { format: "unknown" as const, status: "corrupt" as const, parser: "-", reason: "Не удалось прочитать файл", text: "" }; }
      const { text, ...extraction } = result;
      entry = { path: file.path, text: extraction.status === "ok" ? text : "", extraction };
    }
    const cost = entry.text.length + entry.path.length + 160;
    if (part.length && (part.length >= PACKAGE_LIMITS.partFiles || chars + cost > PACKAGE_LIMITS.partChars)) { const done = flush(); if (done) yield done; }
    part.push(entry); chars += cost;
  }
  const last = flush();
  if (last) yield last;
}

export const WARNING_CODE_LABEL: Record<string, string> = {
  empty: "Нет текста",
  unsupported: "Формат не поддерживается",
  corrupt: "Повреждён",
  protected: "Защищён паролем",
  too_large: "Слишком большой",
  timeout: "Превышено время чтения",
  extraction_missing: "Текст не извлечён",
  no_owner: "Не указан кандидат"
};

export function groupWarnings(warnings: { path: string; reason: string; code?: string }[]): { code: string; label: string; items: { path: string; reason: string }[] }[] {
  const groups = new Map<string, { path: string; reason: string }[]>();
  for (const warning of warnings) {
    const code = warning.code ?? "other";
    groups.set(code, [...(groups.get(code) ?? []), { path: warning.path, reason: warning.reason }]);
  }
  return [...groups.entries()].map(([code, items]) => ({ code, label: WARNING_CODE_LABEL[code] ?? "Прочее", items }));
}
