import JSZip from "jszip";
import type { HhExtraction } from "@orion/shared-types";

/**
 * Извлечение текста из документов кандидата (PDF / DOCX / RTF) до загрузки в ORION.
 *
 * Принципы:
 * - Формат определяется по содержимому (magic bytes), а не по расширению: «.doc» бывает RTF, DOCX или старым OLE-файлом.
 * - Ничего не исполняется: PDF читается без eval/скриптов, DOCX — только `word/document.xml` как текст, RTF — собственный
 *   разбор без внешних объектов, макросы и вложения игнорируются.
 * - Пустой или неудачный результат НЕ выдаётся за успех: статус `empty` / `corrupt` / `protected` / `unsupported` /
 *   `too_large` / `timeout` попадает в отчёт предпросмотра с причиной.
 * - Ограничения: размер файла, число записей архива, размер распакованного XML, число страниц PDF, время.
 */

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 50000;
const MAX_XML_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;
const MAX_PDF_PAGES = 150;
const MAX_RTF_DEPTH = 200;
export const EXTRACTION_TIMEOUT_MS = 30000;

export const PARSER_DOCX = "orion-docx-xml@1";
export const PARSER_RTF = "orion-rtf@2";
export const PARSER_TEXT = "text";

export type ExtractionOutcome = HhExtraction & { text: string };

const outcome = (format: HhExtraction["format"], status: HhExtraction["status"], parser: string, reason: string, text = ""): ExtractionOutcome => ({ format, status, parser, reason, text });

export function sniffDocument(bytes: Uint8Array): HhExtraction["format"] {
  const head = bytes.subarray(0, 1024);
  const ascii = (from: number, value: string) => value.split("").every((c, i) => head[from + i] === c.charCodeAt(0));
  for (let i = 0; i + 5 <= head.length; i += 1) if (ascii(i, "%PDF-")) return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "docx";
  if (ascii(0, String.fromCharCode(0x7b) + "\\rtf")) return "rtf";
  if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => head[i] === b)) return "doc";
  const sample = bytes.subarray(0, 8192);
  return sample.includes(0) ? "unknown" : "text";
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Текст основного документа DOCX из `word/document.xml`: абзацы, табы, переводы строк, ячейки таблиц. */
export function docxXmlToText(xml: string): string {
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>|<w:delText[^>]*>[^<]*<\/w:delText>/g;
  let out = "";
  for (let m = token.exec(xml); m; m = token.exec(xml)) {
    const raw = m[0];
    if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
    else if (raw.startsWith("<w:tab")) out += "\t";
    else if (raw.startsWith("<w:br") || raw.startsWith("<w:cr") || raw === "</w:p>" || raw === "</w:tr>") out += "\n";
    else if (raw === "</w:tc>") out += "\t";
  }
  return tidy(out);
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractionOutcome> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { return outcome("docx", "corrupt", PARSER_DOCX, "Архив DOCX повреждён или не открывается"); }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ZIP_ENTRIES) return outcome("docx", "too_large", PARSER_DOCX, `В архиве больше ${MAX_ZIP_ENTRIES} записей — файл не читается`);
  if (Object.values(zip.files).some((file) => {
    const path = (file as typeof file & { unsafeOriginalName?: string }).unsafeOriginalName ?? file.name;
    return path.startsWith("/") || path.split(/[\\/]/).includes("..") || path.includes("\\");
  })) return outcome("docx", "corrupt", PARSER_DOCX, "Небезопасные пути внутри архива");
  const entry = zip.file("word/document.xml");
  if (!entry) return outcome("docx", "unsupported", PARSER_DOCX, "Это ZIP-файл без word/document.xml — не документ Word (DOCX)");
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared !== "number") return outcome("docx", "corrupt", PARSER_DOCX, "Не удалось проверить размер содержимого документа");
  if (declared > MAX_XML_BYTES) return outcome("docx", "too_large", PARSER_DOCX, "Содержимое документа после распаковки слишком велико");
  let xml: string;
  try {
    // Enforce the actual inflated byte count as well as ZIP metadata. A forged central
    // directory must not allow unbounded allocation before JSZip detects a size mismatch.
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      let size = 0; const chunks: Uint8Array[] = [];
      // JSZip 3.10 exposes this browser API at runtime but omits it from JSZipObject typings.
      const stream = (entry as unknown as { internalStream(type: "uint8array"): {
        on(event: "data", callback: (chunk: Uint8Array) => void): void;
        on(event: "error", callback: (error: unknown) => void): void;
        on(event: "end", callback: () => void): void;
        pause(): void; resume(): void;
      } }).internalStream("uint8array");
      stream.on("data", (chunk: Uint8Array) => {
        size += chunk.length;
        if (size > MAX_XML_BYTES) { stream.pause(); reject(new Error("inflated_limit")); return; }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => { const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } resolve(result); });
      stream.resume();
    });
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  catch { return outcome("docx", "corrupt", PARSER_DOCX, "Не удалось прочитать содержимое DOCX"); }
  const text = docxXmlToText(xml);
  return text ? outcome("docx", "ok", PARSER_DOCX, "", text) : outcome("docx", "empty", PARSER_DOCX, "В документе нет текста");
}

const RTF_SKIP_DESTINATIONS = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr", "footerl", "footerr", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator", "fldinst", "bkmkstart", "bkmkend", "shpinst", "blipuid"]);
const RTF_CHARS: Record<string, string> = { par: "\n", line: "\n", sect: "\n\n", page: "\n", tab: "\t", emdash: "—", endash: "\u2013", bullet: "\u2022", lquote: "\u2018", rquote: "\u2019", ldblquote: "\u201C", rdblquote: "\u201D", emspace: " ", enspace: " " };

function rtfByteDecoder(codepage: number): (byte: number) => string {
  const label = codepage === 1251 ? "windows-1251" : codepage === 1252 || !codepage ? "windows-1252" : `windows-${codepage}`;
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(label); } catch { decoder = new TextDecoder("windows-1252"); }
  return (byte) => decoder.decode(new Uint8Array([byte]));
}

/** Минимальный безопасный разбор RTF в текст. Возвращает null при структурной порче (непарные скобки, чрезмерная вложенность). */
export function rtfToText(source: string): string | null {
  const codepage = Number(/\\ansicpg(\d+)/.exec(source.slice(0, 2000))?.[1] ?? 0);
  const decodeByte = rtfByteDecoder(codepage);
  const stack: { skip: boolean; uc: number }[] = [];
  let state = { skip: false, uc: 1 };
  let out = ""; let pendingSkip = 0; let depthSeen = 0; let started = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") { stack.push(state); state = { ...state }; depthSeen += 1; if (stack.length > MAX_RTF_DEPTH) return null; started = true; continue; }
    if (ch === "}") { const previous = stack.pop(); if (!previous) return null; state = previous; continue; }
    if (!started) continue;
    if (ch === "\\") {
      const next = source[i + 1];
      if (next === undefined) return null;
      if (next === "\\" || next === "{" || next === "}") { if (!state.skip) out += next; i += 1; continue; }
      if (next === "~") { if (!state.skip) out += "\u00A0"; i += 1; continue; }
      if (next === "_") { if (!state.skip) out += "\u2011"; i += 1; continue; }
      if (next === "-" || next === "|" || next === ":") { i += 1; continue; }
      if (next === "*") { state.skip = true; i += 1; continue; }
      if (next === "'") {
        const hex = source.slice(i + 2, i + 4);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
        if (pendingSkip > 0) pendingSkip -= 1; else if (!state.skip) out += decodeByte(parseInt(hex, 16));
        i += 3; continue;
      }
      const word = /^[a-zA-Z]+/.exec(source.slice(i + 1, i + 40));
      if (!word) { i += 1; continue; }
      const name = word[0];
      let j = i + 1 + name.length;
      const numberMatch = /^-?\d+/.exec(source.slice(j, j + 12));
      const param = numberMatch ? parseInt(numberMatch[0], 10) : null;
      if (numberMatch) j += numberMatch[0].length;
      if (source[j] === " ") j += 1;
      i = j - 1;
      if (RTF_SKIP_DESTINATIONS.has(name)) { state.skip = true; continue; }
      if (name === "uc" && param !== null) { state.uc = Math.max(0, Math.min(param, 8)); continue; }
      if (name === "u" && param !== null) {
        if (!state.skip) out += String.fromCharCode(param < 0 ? param + 65536 : param);
        pendingSkip = state.uc; continue;
      }
      if (!state.skip && Object.prototype.hasOwnProperty.call(RTF_CHARS, name)) out += RTF_CHARS[name];
      continue;
    }
    if (ch === "\r" || ch === "\n") continue;
    if (pendingSkip > 0) { pendingSkip -= 1; continue; }
    if (!state.skip) out += ch;
  }
  if (stack.length !== 0 || depthSeen === 0) return null;
  return tidy(out);
}

function extractRtf(bytes: Uint8Array): ExtractionOutcome {
  // Decode raw ANSI text with the declared codepage too, not only escaped \'xx.
  // TextDecoder("latin1") is actually Windows-1252 and does not preserve bytes 1:1.
  let source = "";
  for (let i = 0; i < bytes.length; i += 8192) source += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const codepage = Number(/\\ansicpg(\d+)/.exec(source.slice(0, 2000))?.[1] ?? 1252);
  if (codepage < 1250 || codepage > 1258) return outcome("rtf", "unsupported", PARSER_RTF, `Кодировка RTF ${codepage} не поддерживается — сохраните документ как DOCX`);
  const decodeByte = rtfByteDecoder(codepage);
  source = source.replace(/[\u0080-\u00ff]/g, (ch) => decodeByte(ch.charCodeAt(0)));
  const text = rtfToText(source);
  if (text === null) return outcome("rtf", "corrupt", PARSER_RTF, "RTF повреждён: непарные скобки или недопустимая структура");
  return text ? outcome("rtf", "ok", PARSER_RTF, "", text) : outcome("rtf", "empty", PARSER_RTF, "В RTF нет текста");
}

function containsUtf16(bytes: Uint8Array, needle: string): boolean {
  const limit = Math.min(bytes.length, 4 * 1024 * 1024);
  const first = needle.charCodeAt(0);
  for (let i = 0; i + needle.length * 2 <= limit; i += 1) {
    if (bytes[i] !== first || bytes[i + 1] !== 0) continue;
    let match = true;
    for (let k = 1; k < needle.length; k += 1) if (bytes[i + k * 2] !== needle.charCodeAt(k) || bytes[i + k * 2 + 1] !== 0) { match = false; break; }
    if (match) return true;
  }
  return false;
}

/** Минимальная часть pdfjs, которая нужна экстрактору (внедряется: в браузере — `pdfjs-dist`, в тестах — legacy-сборка). */
export interface PdfjsLike {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocumentLike>; destroy(): Promise<void> | void };
}
interface PdfDocumentLike { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup?: () => void }>; destroy(): Promise<void> | void }

export const PARSER_PDF_PREFIX = "pdfjs-dist@";

async function extractPdf(bytes: Uint8Array, pdfjs: PdfjsLike, version: string): Promise<ExtractionOutcome> {
  const parser = `${PARSER_PDF_PREFIX}${version}`;
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0 });
  let doc: PdfDocumentLike;
  try { doc = await task.promise; }
  catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    if (name === "PasswordException") return outcome("pdf", "protected", parser, "PDF защищён паролем — текст не извлечён");
    return outcome("pdf", "corrupt", parser, "PDF повреждён или не открывается");
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) return outcome("pdf", "too_large", parser, `В PDF больше ${MAX_PDF_PAGES} страниц — файл не читается`);
    let text = "";
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let lastEnd: number | null = null;
      for (const raw of content.items) {
        const item = raw as { str?: string; hasEOL?: boolean; transform?: number[]; width?: number };
        if (typeof item.str !== "string") continue;
        const x = item.transform?.[4];
        if (lastEnd !== null && typeof x === "number" && x - lastEnd > 1 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
        text += item.str;
        lastEnd = typeof x === "number" && typeof item.width === "number" ? x + item.width : null;
        if (item.hasEOL) { text += "\n"; lastEnd = null; }
      }
      text += "\n\n";
      page.cleanup?.();
      if (text.length > MAX_EXTRACTED_CHARS * 4) break;
    }
    const clean = tidy(text);
    return clean ? outcome("pdf", "ok", parser, "", clean) : outcome("pdf", "empty", parser, "В PDF нет текстового слоя (похоже на скан); распознавание изображений (OCR) не выполняется");
  } catch {
    return outcome("pdf", "corrupt", parser, "Не удалось прочитать страницы PDF");
  } finally {
    try { await doc.destroy(); } catch { /* ресурсы освобождаются сборщиком */ }
  }
}

export interface DocumentInput { name: string; size: number; bytes(): Promise<Uint8Array>; text(): Promise<string> }
export interface ExtractionDeps { loadPdfjs(): Promise<{ pdfjs: PdfjsLike; version: string }>; timeoutMs?: number }

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(onTimeout()), ms); })]).finally(() => clearTimeout(timer));
}

function capLength(result: ExtractionOutcome): ExtractionOutcome {
  if (result.status === "ok" && result.text.length > MAX_EXTRACTED_CHARS) return outcome(result.format, "too_large", result.parser, `Извлечённый текст длиннее ${MAX_EXTRACTED_CHARS} символов`);
  return result;
}

/** Главный вход: читает файл целиком в память один раз и отдаёт результат с понятным статусом. */
export async function extractDocumentText(file: DocumentInput, deps: ExtractionDeps): Promise<ExtractionOutcome> {
  const isText = /\.(?:md|txt)$/i.test(file.name);
  if (isText) {
    if (file.size > 800000) return outcome("text", "too_large", PARSER_TEXT, "Текстовый файл больше 800 КБ");
    const text = (await file.text()).replace(/^\uFEFF/, "");
    if (text.includes("\0")) return outcome("text", "corrupt", PARSER_TEXT, "В файле двоичные данные — это не текст");
    return text.trim() ? outcome("text", "ok", PARSER_TEXT, "", text) : outcome("text", "empty", PARSER_TEXT, "Файл пуст");
  }
  if (file.size > MAX_DOCUMENT_BYTES) return outcome("unknown", "too_large", "-", `Файл больше ${MAX_DOCUMENT_BYTES / 1024 / 1024} МБ`);
  const timeoutMs = deps.timeoutMs ?? EXTRACTION_TIMEOUT_MS;
  const bytes = await file.bytes();
  if (bytes.length === 0) return outcome("unknown", "empty", "-", "Файл пуст");
  const format = sniffDocument(bytes);
  const timedOut = (f: HhExtraction["format"]) => outcome(f, "timeout", "-", `Извлечение текста заняло больше ${Math.round(timeoutMs / 1000)} с и остановлено`);
  const extension = /\.([a-z]+)$/i.exec(file.name)?.[1].toLowerCase();
  if (extension === "pdf" && format !== "pdf") return outcome(format, "corrupt", "-", "Файл с расширением PDF не является PDF");
  switch (format) {
    case "pdf": {
      const { pdfjs, version } = await deps.loadPdfjs();
      return capLength(await withTimeout(extractPdf(bytes, pdfjs, version), timeoutMs, () => timedOut("pdf")));
    }
    case "docx": return capLength(await withTimeout(extractDocx(bytes), timeoutMs, () => timedOut("docx")));
    case "rtf": return capLength(extractRtf(bytes));
    case "doc":
      return containsUtf16(bytes, "EncryptedPackage")
        ? outcome("doc", "protected", "-", "Документ зашифрован паролем — текст не извлечён")
        : outcome("doc", "unsupported", "-", "Старый двоичный формат Word (.doc) не читается. Сохраните файл как DOCX, RTF или PDF и выберите его снова");
    default:
      return outcome(format, "unsupported", "-", "Формат файла не распознан");
  }
}
