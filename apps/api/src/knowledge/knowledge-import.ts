import type { KnowledgeOrigin } from "@orion/shared-types";

/**
 * Чистые помощники импорта в базу знаний (задание 06, п. 6.4): имя материала из файла,
 * распознавание ссылки во входящем и сборка `origin`. Вынесены из сервиса, чтобы
 * проверялись без БД.
 */

/** «Договор аренды.pdf» → «Договор аренды». Имя без расширения остаётся как есть. */
export function knowledgeTitleFromFile(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Без названия";
  const withoutExt = trimmed.replace(/\.[a-z0-9]{1,10}$/i, "").trim();
  return withoutExt || trimmed;
}

/** Первая http(s)-ссылка в тексте или `null`. */
export function firstHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0] : null;
}

/** Источник для материала из записи «Входящих»: кто/когда импортировал и ссылка, если запись — ссылка. */
export function originFromInbox(
  inbox: { title: string; body: string; createdByAgent: string | null },
  importedBy: string,
  now: Date
): KnowledgeOrigin {
  const url = firstHttpUrl(inbox.body) ?? firstHttpUrl(inbox.title) ?? undefined;
  return {
    importedAt: now.toISOString(),
    importedBy,
    ...(url ? { sourceUrl: url } : {}),
    ...(inbox.createdByAgent ? { author: inbox.createdByAgent } : {})
  };
}

/** Источник для материала из файла Documents. */
export function originFromFile(fileName: string, importedBy: string, now: Date): KnowledgeOrigin {
  return { sourceFile: fileName, importedAt: now.toISOString(), importedBy };
}
