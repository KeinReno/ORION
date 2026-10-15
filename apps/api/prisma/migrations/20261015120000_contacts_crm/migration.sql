-- «Контакты» как полноценная записная книжка: тип (человек/организация), организация,
-- несколько телефонов/почт/ссылок, адрес, день рождения, теги, избранное, архив,
-- «связаться раз в N дней», журнал общения и связи между контактами.
-- Колонки phone/email остаются «основными» значениями — их читает модуль «Дом».
-- RLS таблицы contacts не меняется (политика уже есть); для двух новых таблиц она заводится ниже.
ALTER TABLE "contacts"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'person',
  ADD COLUMN "organization" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "phones" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "emails" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "links" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "birthday" DATE,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contactEveryDays" INTEGER,
  ADD COLUMN "lastContactedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "contact_interactions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "note" TEXT NOT NULL DEFAULT '',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_interactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "contact_interactions_workspaceId_idx" ON "contact_interactions"("workspaceId");
CREATE INDEX "contact_interactions_contactId_occurredAt_idx" ON "contact_interactions"("contactId", "occurredAt");
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contact_relations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactAId" TEXT NOT NULL,
    "contactBId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_relations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_relations_ordered_pair" CHECK ("contactAId" < "contactBId")
);
CREATE UNIQUE INDEX "contact_relations_contactAId_contactBId_key" ON "contact_relations"("contactAId", "contactBId");
CREATE INDEX "contact_relations_workspaceId_idx" ON "contact_relations"("workspaceId");
CREATE INDEX "contact_relations_contactBId_idx" ON "contact_relations"("contactBId");
ALTER TABLE "contact_relations" ADD CONSTRAINT "contact_relations_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_relations" ADD CONSTRAINT "contact_relations_contactAId_fkey"
  FOREIGN KEY ("contactAId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_relations" ADD CONSTRAINT "contact_relations_contactBId_fkey"
  FOREIGN KEY ("contactBId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_interactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_interactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_interactions_isolation ON "contact_interactions"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "contact_interactions"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));

ALTER TABLE "contact_relations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_relations" FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_relations_isolation ON "contact_relations"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "contact_relations"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));
