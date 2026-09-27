/**
 * O04 — small glue between the DOCX/XLSX codecs (O01/O01b/O02,
 * `apps/web/lib/office/{docx,xlsx}-codec.ts`) and the UI: recognizing an
 * office `Document` by MIME/extension, and generating a valid empty
 * DOCX/XLSX `File` for "Создать документ"/"Создать таблицу" (O04 task item
 * 1 — no new server endpoint, see 12-PROGRESS.md "O02" §4: these are
 * ordinary files from `POST .../documents/upload`'s point of view).
 */

import type { DocumentItem } from "@orion/shared-types";
import { tiptapJsonToDocx } from "./docx-codec";
import { workbookStateToXlsx } from "./xlsx-codec";

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

/** A brand-new, valid, empty DOCX — same call the O02 integration test proves round-trips through upload/download. */
export async function createEmptyDocxFile(name = "Новый документ.docx"): Promise<File> {
  const bytes = await tiptapJsonToDocx({ type: "doc", content: [] });
  return new File([bytes as unknown as BlobPart], name, { type: DOCX_MIME });
}

/** A brand-new, valid, empty XLSX (one empty "Sheet1") — same call the O02 integration test proves round-trips through upload/download. */
export async function createEmptyXlsxFile(name = "Новая таблица.xlsx"): Promise<File> {
  const bytes = await workbookStateToXlsx({ sheets: [{ name: "Sheet1", rows: [] }] });
  return new File([bytes as unknown as BlobPart], name, { type: XLSX_MIME });
}
