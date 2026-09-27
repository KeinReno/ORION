-- U03: personal one-shot reminder against any registered entity
-- (project/task/note/event/document/transaction). New, separate table —
-- does NOT touch tasks.dueAt / events reminder columns.

CREATE TABLE "entity_reminders" (
    "id"          TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId"     TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "entityType"  TEXT NOT NULL,
    "entityId"    TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone"    TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "deliveredAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entity_reminders_workspaceId_idx" ON "entity_reminders"("workspaceId");
CREATE INDEX "entity_reminders_status_scheduledAt_idx" ON "entity_reminders"("status", "scheduledAt");
CREATE INDEX "entity_reminders_entityType_entityId_idx" ON "entity_reminders"("entityType", "entityId");

ALTER TABLE "entity_reminders" ADD CONSTRAINT "entity_reminders_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_reminders" ADD CONSTRAINT "entity_reminders_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_reminders" ADD CONSTRAINT "entity_reminders_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — same flat membership-check shape as every other workspace-owned
-- table (see CLAUDE.md "Postgres RLS"); the structural integration test
-- asserts ENABLE + FORCE + a policy for every table carrying "workspaceId".

ALTER TABLE "entity_reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entity_reminders" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_reminders_isolation ON "entity_reminders"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "entity_reminders"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
