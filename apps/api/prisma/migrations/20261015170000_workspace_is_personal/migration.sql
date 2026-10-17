-- ТЗ-05: личное пространство — то, что создаётся при регистрации. Его нельзя
-- открыть другим (приглашения в него отклоняются), общие пространства — отдельные.
ALTER TABLE "workspaces" ADD COLUMN "isPersonal" BOOLEAN NOT NULL DEFAULT false;

-- Уже существующие пространства, созданные регистрацией (см. AuthService.register):
-- имя "… — личное пространство" и ровно один участник-владелец.
UPDATE "workspaces" w
SET "isPersonal" = true
WHERE w."name" LIKE '% — личное пространство'
  AND (SELECT count(*) FROM "workspace_members" m WHERE m."workspaceId" = w."id") = 1;
