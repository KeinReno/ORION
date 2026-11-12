import { Module } from "@nestjs/common";
import { InboxItemsReader } from "../inbox-items-reader.service";
import { InboxItems } from "./inbox-items";

/** Экспорт публичного контракта «Входящих» (чтение/удаление записи) для соседних модулей. */
@Module({
  providers: [{ provide: InboxItems, useClass: InboxItemsReader }],
  exports: [InboxItems]
})
export class InboxItemsModule {}
