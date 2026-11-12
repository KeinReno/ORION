import type { Prisma } from "@prisma/client";

/** Что нужно другому модулю от записи «Входящих» при маршрутизации в свою сущность. */
export interface InboxItemSnapshot {
  id: string;
  title: string;
  body: string;
  projectId: string | null;
  createdByAgent: string | null;
  kind: string;
}

/**
 * Публичный контракт «Входящих» для модулей, принимающих запись (задание 06: Knowledge).
 * Модуль-владелец вызывает его внутри своей `withUser`-транзакции: чтение и удаление идут
 * в той же транзакции, что и создание новой сущности, поэтому «перенести и убрать из входящих»
 * не оставляет половинчатого результата и не требует импорта внутренностей inbox.
 */
export abstract class InboxItems {
  /** Запись этого пространства или `null`, если её нет/она уже удалена. */
  abstract readTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<InboxItemSnapshot | null>;
  /** Удаляет запись; `true` — если строка действительно была удалена. */
  abstract removeTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<boolean>;
}
