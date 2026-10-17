-- "Объект изменился после запроса": что запрос агента брал за основу. Колонки nullable — прежние запросы
-- остаются без основы и устаревшими не считаются. Таблица уже под RLS (политики не меняются).
ALTER TABLE "agent_proposals" ADD COLUMN "baseRevision" INTEGER, ADD COLUMN "baseUpdatedAt" TIMESTAMP(3);
