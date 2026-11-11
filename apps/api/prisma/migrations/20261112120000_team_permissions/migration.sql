-- 12-team-access / 12.1–12.4 — единая команда человек+ИИ, приглашения со сроком и аудитом,
-- упоминания в комментариях (очередь агента) и CAS-ревизия проекта.
--
-- Почему триггер, а не код модуля: членство агента обязано ссылаться на AgentHubAgentProfile
-- (задание 12.1), но agent-hub — подключаемый модуль, и его модели лежат в генерируемой области
-- schema.prisma. Импорт и Prisma-делегат из `workspaces/` нарушили бы границу модулей
-- (scripts/architecture-check.mjs), а публичного контракта-читателя у agent-hub нет. Поэтому связь
-- держится на уровне БД: профиль появился — появилось агентское членство; профиль удалён — членство
-- ушло. Триггер SECURITY DEFINER, потому что создания профиля и восстановление снапшота бывают без
-- `app.current_user_id` (asSystem), а политика workspace_members требует живого участника.

-- ── 12.1. Principal-модель членства ──────────────────────────────────────────────────────────────
ALTER TABLE "workspace_members"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "agentProfileId" TEXT;

ALTER TABLE "workspace_members" ALTER COLUMN "userId" DROP NOT NULL;

-- Существующие строки — люди, как и были: миграция ничего не меняет в их семантике.
UPDATE "workspace_members" SET "kind" = 'human', "status" = 'active' WHERE "kind" IS NULL OR "kind" = '';

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_principal_check" CHECK (
    ("kind" = 'human' AND "userId" IS NOT NULL AND "agentProfileId" IS NULL) OR
    ("kind" = 'agent' AND "userId" IS NULL AND "agentProfileId" IS NOT NULL)
  ),
  ADD CONSTRAINT "workspace_members_kind_check" CHECK ("kind" IN ('human', 'agent')),
  ADD CONSTRAINT "workspace_members_status_check" CHECK ("status" IN ('active', 'disabled'));

-- Один профиль — одно членство в пространстве. NULL для людей, поэтому уникальность людям не мешает.
CREATE UNIQUE INDEX "workspace_members_workspaceId_agentProfileId_key"
  ON "workspace_members"("workspaceId", "agentProfileId");

CREATE INDEX "workspace_members_workspaceId_kind_idx" ON "workspace_members"("workspaceId", "kind");

-- Связь «профиль → членство» на уровне БД (без Prisma-relation: agent-hub-модели генерируются).
-- FK намеренно не ставим: профили живут в подключаемом модуле, его таблица может отсутствовать в
-- сборке без плагина, а членство обязано пережить установку/удаление плагина.
CREATE OR REPLACE FUNCTION team_agent_member_sync() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "workspace_members" ("id", "workspaceId", "userId", "role", "kind", "status", "agentProfileId", "createdAt")
    VALUES (gen_random_uuid()::text, NEW."workspaceId", NULL, 'member', 'agent', 'active', NEW."id", NEW."createdAt")
    ON CONFLICT ("workspaceId", "agentProfileId") DO UPDATE SET "status" = 'active';
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM "workspace_members"
    WHERE "kind" = 'agent' AND "workspaceId" = OLD."workspaceId" AND "agentProfileId" = OLD."id";
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION team_agent_member_sync() OWNER TO orion;

DO $$
BEGIN
  IF to_regclass('public.agent_hub_agent_profiles') IS NULL THEN
    RETURN;
  END IF;

  -- Существующие профили получают членство теми же правилами, что и новые.
  INSERT INTO "workspace_members" ("id", "workspaceId", "userId", "role", "kind", "status", "agentProfileId", "createdAt")
  SELECT gen_random_uuid()::text, p."workspaceId", NULL, 'member', 'agent', 'active', p."id", p."createdAt"
  FROM "agent_hub_agent_profiles" p
  ON CONFLICT ("workspaceId", "agentProfileId") DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'agent_hub_agent_profile_membership') THEN
    EXECUTE 'CREATE TRIGGER "agent_hub_agent_profile_membership"
             AFTER INSERT OR DELETE ON "agent_hub_agent_profiles"
             FOR EACH ROW EXECUTE FUNCTION team_agent_member_sync()';
  END IF;
END;
$$;

-- ── 12.2. Приглашения: срок, явный дефолт, отзыв и повтор с аудитом ─────────────────────────────
ALTER TABLE "workspace_invites"
  ALTER COLUMN "expiresAt" DROP NOT NULL,
  ADD COLUMN "revokedById" TEXT,
  ADD COLUMN "resentAt" TIMESTAMP(3),
  ADD COLUMN "resentById" TEXT,
  ADD COLUMN "resendCount" INTEGER NOT NULL DEFAULT 0;

-- ── 12.4. CAS-ревизия проекта (как Task.revision / Note.revision) ───────────────────────────────
ALTER TABLE "projects" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- ── 12.3. Очередь событий агентского членства (упоминания) ──────────────────────────────────────
CREATE TABLE "agent_member_events" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'mention',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "entityType" TEXT,
  "entityId" TEXT,
  "actorUserId" TEXT,
  "eventKey" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_member_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_member_events_memberId_eventKey_key" ON "agent_member_events"("memberId", "eventKey");
CREATE INDEX "agent_member_events_workspaceId_memberId_readAt_idx" ON "agent_member_events"("workspaceId", "memberId", "readAt");
CREATE INDEX "agent_member_events_createdAt_idx" ON "agent_member_events"("createdAt");

ALTER TABLE "agent_member_events"
  ADD CONSTRAINT "agent_member_events_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_member_events"
  ADD CONSTRAINT "agent_member_events_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_member_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_member_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_member_events_isolation ON "agent_member_events"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_member_events"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_member_events"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
