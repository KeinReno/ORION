import type { Prisma } from "@prisma/client";
import type { InboxItem, OrionModuleId } from "@orion/shared-types";

/** Что цель знает о записи входящих: заголовок/тело и уже вычисленные срок и проект. */
export interface InboxTargetContext {
  userId: string;
  workspaceId: string;
  title: string;
  body: string;
  dueAt: Date | string | null;
  projectId: string | null;
}

/**
 * G19: «превратить входящее в X». Модуль-владелец сам регистрирует цель (`InboxTargetRegistry.register`), а
 * `InboxService` лишь находит её по виду записи и вызывает `createTx` — таблиц чужих модулей он не трогает.
 * Захват записи (`updateMany ... processedAt: null`) остаётся в `InboxService`: цель вызывается строго после него.
 */
export interface InboxTarget {
  /** Вид записи входящих, в который она превращается (`InboxItem["kind"]` без «inbox»). */
  readonly kind: Exclude<InboxItem["kind"], "inbox">;
  /** Модуль-владелец; ядро проверяет, что он включён, до вызова `createTx`. */
  readonly componentId: OrionModuleId;
  /** Создаёт сущность в переданной транзакции и возвращает её id. */
  createTx(tx: Prisma.TransactionClient, ctx: InboxTargetContext): Promise<string>;
}
