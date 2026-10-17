import { createHash } from "node:crypto";
import { HH_BINARY_DOCUMENT, HH_MATERIAL_FOLDER, classifyHhMaterialType, classifyHhPath, createOpportunityInputSchema, normalizeHhPath, type CreateOpportunityInput, type HhImportPreviewInput } from "@orion/shared-types";

export function contentHash(text: string): string { return createHash("sha256").update(text).digest("hex"); }
export interface ResumeImportRecord { type?: "resume" | "proposal" | "portfolio"; parser?: string; candidateName: string; profileSourceKey: string; title: string; sourcePath: string; sourceKey: string; content: string; contentHash: string }
export interface VacancyImportRecord { input: CreateOpportunityInput; sourcePath: string; fileHash: string; contentHash: string; snapshot: { title: string; company: string; description: string; url: string; conditions: CreateOpportunityInput["conditions"] } }
export interface HistoryImportRecord { externalId: string | null; title: string; outcome: "already_exists" | "legacy_claimed_verified" | "failed" | "unconfirmed"; sourceTime: string | null; sourcePath: string; recordHash: string; originalStatus: string; reason: string }
export type ImportOperation = { kind: "material"; data: ResumeImportRecord } | { kind: "opportunity"; data: VacancyImportRecord } | { kind: "history"; data: HistoryImportRecord };
export interface HhPlan { version: 1; includeProfiles: boolean; historyProfileId: string | null; operations: ImportOperation[]; warnings: { path: string; reason: string; code?: string }[] }
type Obj = Record<string, unknown>;
function object(value: unknown): value is Obj { return typeof value === "object" && value !== null && !Array.isArray(value); }
function str(value: unknown): string { return typeof value === "string" ? value : ""; }
function vacancyId(value: unknown): string | null {
  const raw = str(value);
  try {
    const url = new URL(raw.startsWith("/") ? `https://hh.ru${raw}` : raw);
    if (!/^https?:$/.test(url.protocol) || !(url.hostname === "hh.ru" || url.hostname.endsWith(".hh.ru")) || url.username || url.password) return null;
    return url.pathname.match(/\/(?:vacancy|vacancies)\/(\d+)(?:\/|$)/)?.[1] ?? null;
  } catch { return null; }
}
function rawId(item: Obj): string | null { return vacancyId(item.alternate_url) ?? vacancyId(item.url) ?? vacancyId(item.href); }

export function compileHhPlan(input: HhImportPreviewInput): HhPlan {
  const plan: HhPlan = { version: 1, includeProfiles: input.includeProfiles, historyProfileId: input.historyProfileId, operations: [], warnings: [] };
  const warn = (path: string, reason: string, code?: string) => plan.warnings.push(code ? { path, reason, code } : { path, reason });
  const paths = new Set<string>(); const vacancyHashes = new Set<string>(); const histories = new Set<string>();
  for (const file of input.files) {
    const path = normalizeHhPath(file.path); const kind = classifyHhPath(file.path);
    if (!path || kind === "excluded") { warn(file.path, "Служебный файл, браузерная сессия или небезопасный путь — исключён"); continue; }
    if (paths.has(path)) { warn(path, "Повторный путь файла — исключён"); continue; } paths.add(path);
    if (kind === "unsupported") { warn(path, "Формат или категория пока не поддерживается этим импортом"); continue; }
    if (kind === "resume") {
      if (!input.includeProfiles) { warn(path, "Импорт профилей не выбран"); continue; }
      const extraction = file.extraction;
      if (HH_BINARY_DOCUMENT.test(path) && !extraction) { warn(path, "Текст PDF/DOC/RTF извлекается до загрузки, но для этого файла извлечение не выполнено — файл не импортирован", "extraction_missing"); continue; }
      if (extraction && extraction.status !== "ok") { warn(path, `${extraction.reason || "Текст не извлечён"} — файл не импортирован`, extraction.status); continue; }
      const parts = path.split("/"); const resumeIndex = parts.findIndex((p) => HH_MATERIAL_FOLDER.test(p));
      if (resumeIndex === 0) { warn(path, "Выберите папку кандидата целиком, а не только вложенную папку с материалами", "no_owner"); continue; }
      const parent = resumeIndex > 0 ? parts.slice(0, resumeIndex) : parts.slice(0, -1);
      if (!parent.length) { warn(path, "Для резюме выберите папку кандидата, чтобы сохранить его принадлежность", "no_owner"); continue; }
      const content = file.text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
      if (content.includes("\0")) { warn(path, "В тексте есть двоичные данные — файл повреждён или не является текстом", "corrupt"); continue; }
      if (!content) { warn(path, "Документ не содержит текста (пустой или только изображения) — не импортирован", "empty"); continue; }
      if (content.length > 50000) { warn(path, "Текст больше 50 000 символов — не импортирован", "too_large"); continue; }
      const candidateName = parent[parent.length - 1];
      const title = parts[parts.length - 1].replace(/\.(md|txt|pdf|docx?|rtf)$/i, "");
      if (candidateName.length > 200 || title.length > 200) { warn(path, "Слишком длинное имя профиля или трека"); continue; }
      plan.operations.push({ kind: "material", data: { type: classifyHhMaterialType(path), parser: extraction?.parser ?? "text", candidateName, profileSourceKey: `hh-folder:${parent.join("/")}`, title, sourcePath: path, sourceKey: path, content, contentHash: contentHash(content) } });
      continue;
    }
    if (kind === "history" && !input.includeHistory) { warn(path, "Исторические отклики не выбраны"); continue; }
    let value: unknown;
    try { value = JSON.parse(file.text.replace(/^\uFEFF/, "")); }
    catch { warn(path, "Некорректный JSON — файл не импортирован"); continue; }
    if (kind === "history") {
      const records: { row: Obj; failed: boolean }[] = [];
      if (Array.isArray(value)) value.filter(object).forEach((row) => records.push({ row, failed: false }));
      else if (object(value) && (Array.isArray(value.applied) || Array.isArray(value.failed))) {
        for (const key of ["applied", "failed"] as const) if (Array.isArray(value[key])) (value[key] as unknown[]).filter(object).forEach((row) => records.push({ row, failed: key === "failed" }));
      } else if (object(value)) records.push({ row: value, failed: false });
      for (const { row, failed } of records) {
        const reason = str(row.reason).slice(0, 2000); const externalId = rawId(row);
        const outcome: HistoryImportRecord["outcome"] = /already_applied|уже.*отклик/i.test(reason) ? "already_exists" : row.verified === true ? "legacy_claimed_verified" : failed || row.success === false ? "failed" : "unconfirmed";
        const record = { externalId, title: str(row.title).slice(0, 300), outcome, sourceTime: str(row.ts || row.at) || null, originalStatus: str(row.status).slice(0, 100), reason };
        if (!externalId && !record.title) { warn(path, "Запись истории без вакансии и названия — пропущена"); continue; }
        const hash = contentHash(JSON.stringify(record)); if (histories.has(hash)) continue; histories.add(hash);
        plan.operations.push({ kind: "history", data: { ...record, sourcePath: path, recordHash: hash } });
      }
      continue;
    }
    let inspected = 0; let found = 0; let tooComplex = false;
    const operationStart = plan.operations.length; const fileHashes: string[] = [];
    function walk(current: unknown, depth: number): void {
      if (depth > 8 || ++inspected > 10000) { tooComplex = true; return; }
      if (Array.isArray(current)) { current.forEach((v) => walk(v, depth + 1)); return; }
      if (!object(current)) return;
      const id = rawId(current); const title = str(current.title || current.name).trim();
      if (id && title) {
        const company = str(current.company) || (object(current.employer) ? str(current.employer.name) : "");
        const description = str(current.description || current.desc).replace(/<[^>]+>/g, " ").trim();
        const salary = object(current.salary) ? current.salary : {};
        const parsed = createOpportunityInputSchema.safeParse({ kind: "job", title, organizationName: company,
          description, canonicalUrl: `https://hh.ru/vacancy/${id}`, externalId: id, sourceType: "hh", capturedAt: null,
          conditions: { amountMin: typeof salary.from === "number" ? salary.from : null, amountMax: typeof salary.to === "number" ? salary.to : null,
            currency: str(salary.currency) === "RUR" ? "RUB" : str(salary.currency) || "RUB", taxBasis: typeof salary.gross === "boolean" ? salary.gross ? "gross" : "net" : "unknown" } });
        if (!parsed.success) { warn(path as string, `Вакансия ${id}: ${parsed.error.issues.map((i) => i.message).join("; ")}`); return; }
        const snapshot = { title, company, description, url: parsed.data.canonicalUrl as string, conditions: parsed.data.conditions }; const hash = contentHash(JSON.stringify(snapshot));
        if (!vacancyHashes.has(hash)) { vacancyHashes.add(hash); fileHashes.push(hash); found++; plan.operations.push({ kind: "opportunity", data: { input: parsed.data, sourcePath: path as string, fileHash: contentHash(file.text), snapshot, contentHash: hash } }); }
        return; // employer ids are not vacancy ids; don't walk the normalized record's children.
      }
      Object.values(current).forEach((v) => walk(v, depth + 1));
    }
    walk(value, 0);
    if (tooComplex) { plan.operations.splice(operationStart); fileHashes.forEach((hash) => vacancyHashes.delete(hash)); warn(path, "Файл слишком сложный — полностью пропущен. Разбейте файл."); continue; }
    if (!found) warn(path, "Нет новых распознанных вакансий (пустой список или дубли)");
  }
  // Materials precede history; no external actions and no confirmed facts are generated.
  plan.operations.sort((a, b) => ["material", "opportunity", "history"].indexOf(a.kind) - ["material", "opportunity", "history"].indexOf(b.kind));
  return plan;
}
