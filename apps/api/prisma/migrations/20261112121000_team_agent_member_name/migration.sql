-- 12-team-access, дополнение к 20261112120000_team_permissions: имя агента в ростере команды.
--
-- У агентского членства нет `User`, поэтому имя для единого списка команды хранится снимком в
-- `workspace_members.displayName`. Источник истины — профиль Agent Hub; триггер обновляет снимок при
-- вставке профиля и при его переименовании (событие UPDATE), чтобы список не читал чужой модуль
-- через Prisma (граница модулей, scripts/architecture-check.mjs).

ALTER TABLE "workspace_members" ADD COLUMN "displayName" TEXT;

CREATE OR REPLACE FUNCTION team_agent_member_sync() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "workspace_members" ("id", "workspaceId", "userId", "role", "kind", "status", "agentProfileId", "displayName", "createdAt")
    VALUES (gen_random_uuid()::text, NEW."workspaceId", NULL, 'member', 'agent', 'active', NEW."id", NEW."name", NEW."createdAt")
    ON CONFLICT ("workspaceId", "agentProfileId") DO UPDATE
      SET "status" = 'active', "displayName" = EXCLUDED."displayName";
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE "workspace_members"
    SET "displayName" = NEW."name"
    WHERE "kind" = 'agent' AND "workspaceId" = NEW."workspaceId" AND "agentProfileId" = NEW."id";
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

  -- Существующие агентские членства получают имя из профиля.
  UPDATE "workspace_members" wm
  SET "displayName" = p."name"
  FROM "agent_hub_agent_profiles" p
  WHERE wm."kind" = 'agent' AND wm."workspaceId" = p."workspaceId" AND wm."agentProfileId" = p."id";

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'agent_hub_agent_profile_membership') THEN
    EXECUTE 'CREATE TRIGGER "agent_hub_agent_profile_membership"
             AFTER INSERT OR UPDATE OF "name" OR DELETE ON "agent_hub_agent_profiles"
             FOR EACH ROW EXECUTE FUNCTION team_agent_member_sync()';
  ELSE
    -- Первая миграция ставила триггер только на INSERT/DELETE; переименование профиля тоже должно
    -- обновлять снимок имени в ростере.
    EXECUTE 'DROP TRIGGER "agent_hub_agent_profile_membership" ON "agent_hub_agent_profiles"';
    EXECUTE 'CREATE TRIGGER "agent_hub_agent_profile_membership"
             AFTER INSERT OR UPDATE OF "name" OR DELETE ON "agent_hub_agent_profiles"
             FOR EACH ROW EXECUTE FUNCTION team_agent_member_sync()';
  END IF;
END;
$$;
