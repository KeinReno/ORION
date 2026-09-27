import { storageKey } from "../storage/storage-adapter";

/**
 * ORION — S04 «Файловые бэкапы». Чистое (без I/O) вычисление ключей блобов,
 * которые должны попасть в бэкап рабочего пространства.
 *
 * Источник правды для физического расположения файла — `documents.service.ts`
 * (`TRASH_DIR`/`VERSIONS_DIR`/`folderSegmentsTx`), но эти константы там не
 * экспортированы (см. комментарий у `TRASH_DIR`/`VERSIONS_DIR` в этом файле —
 * держим их значения синхронно вручную; несовпадение сразу ловится
 * интеграционным тестом roundtrip'а бэкапа, который реально скачивает файл по
 * вычисленному ключу и сравнивает байты). Дублировать здесь, а не импортировать
 * из `documents.service.ts`, чтобы `sync` не тянул на себя приватные детали
 * чужого модуля — тот же принцип, что уже применён к `SNAPSHOT_MODELS`.
 */
export const TRASH_DIR = ".trash";
export const VERSIONS_DIR = ".versions";

export interface DocumentRowForBlobs {
  id: string;
  workspaceId: string;
  kind: "file" | "folder";
  name: string;
  parentId: string | null;
  deletedAt: Date | string | null;
}

export interface DocumentVersionRowForBlobs {
  id: string;
  workspaceId: string;
  storageKey: string;
  mimeType: string | null;
}

export interface BlobRef {
  /** Storage key байтов. */
  key: string;
  /** MIME для putFile при восстановлении; null — неизвестен (папка версии без mimeType). */
  contentType: string;
}

/**
 * Строит `folderId -> [name-цепочка от корня]` без похода в БД — вызывающий
 * уже загрузил все документы пространства одним `findMany` (то же самое,
 * что снапшот и так делает для `documents`), так что дерево можно пройти в
 * памяти вместо `folderSegmentsTx`'а по одному узлу за раз.
 */
export function folderSegmentsFromRows(
  rows: DocumentRowForBlobs[],
  parentId: string | null
): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const segments: string[] = [];
  const seen = new Set<string>();
  let current = parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    segments.unshift(folder.name);
    current = folder.parentId;
  }
  return segments;
}

/**
 * Все ключи блобов, которые нужно скопировать в бэкап: текущее содержимое
 * каждого файлового `Document` (живого или в корзине — оба физически
 * существуют на диске, `DocumentTrashPurgeService` их удалит позже, а не
 * сейчас) плюс архивные версии (`DocumentVersion.storageKey`, уже готовый
 * ключ). Папки (`kind: "folder"`) не имеют собственных байтов.
 */
export function collectBlobRefs(
  documents: DocumentRowForBlobs[],
  versions: DocumentVersionRowForBlobs[]
): BlobRef[] {
  const refs: BlobRef[] = [];
  for (const doc of documents) {
    if (doc.kind !== "file") continue;
    const key = doc.deletedAt
      ? storageKey(doc.workspaceId, TRASH_DIR, doc.id)
      : storageKey(doc.workspaceId, ...folderSegmentsFromRows(documents, doc.parentId), doc.name);
    refs.push({ key, contentType: "application/octet-stream" });
  }
  for (const v of versions) {
    refs.push({ key: v.storageKey, contentType: v.mimeType ?? "application/octet-stream" });
  }
  return refs;
}
