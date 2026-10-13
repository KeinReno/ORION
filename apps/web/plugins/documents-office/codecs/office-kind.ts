import type { DocumentItem } from "@orion/shared-types";

/**
 * Which files the office editors open. Kept apart from `office-files.ts` (which statically
 * imports the DOCX/XLSX codecs) so the plugin registry can ask "is this an office file?"
 * without pulling the codecs into the main bundle.
 */

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function ext(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

/** Same "MIME first, extension fallback" rule as `documentGroup`/`previewKind` (`document-icons.ts`, `@orion/ui`'s `FilePreview`). */
export function isDocxDocument(doc: Pick<DocumentItem, "mimeType" | "name">): boolean {
  const m = (doc.mimeType ?? "").toLowerCase();
  return m === DOCX_MIME || (!m && ext(doc.name) === "docx") || ext(doc.name) === "docx";
}

export function isXlsxDocument(doc: Pick<DocumentItem, "mimeType" | "name">): boolean {
  const m = (doc.mimeType ?? "").toLowerCase();
  return m === XLSX_MIME || (!m && ext(doc.name) === "xlsx") || ext(doc.name) === "xlsx";
}

/** True for the files the office editors know how to open (DOCX/XLSX). */
export function isOfficeFile(doc: Pick<DocumentItem, "kind" | "mimeType" | "name">): boolean {
  return doc.kind === "file" && (isDocxDocument(doc) || isXlsxDocument(doc));
}
