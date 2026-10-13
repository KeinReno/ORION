/**
 * O04 — small glue between the DOCX/XLSX codecs (O01/O01b/O02,
 * `./{docx,xlsx}-codec.ts`) and the UI: recognizing an
 * office `Document` by MIME/extension, and generating a valid empty
 * DOCX/XLSX `File` for "Создать документ"/"Создать таблицу" (O04 task item
 * 1 — no new server endpoint, see 12-PROGRESS.md "O02" §4: these are
 * ordinary files from `POST .../documents/upload`'s point of view).
 */

import { tiptapJsonToDocx } from "./docx-codec";
import { workbookStateToXlsx } from "./xlsx-codec";

export { DOCX_MIME, XLSX_MIME, isDocxDocument, isXlsxDocument } from "./office-kind";
import { DOCX_MIME, XLSX_MIME } from "./office-kind";

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
