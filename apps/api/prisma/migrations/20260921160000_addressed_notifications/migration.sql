-- S07 · Addressed notifications: recipientId + eventKey + per-recipient RLS.
--
-- Existing rows keep recipientId/eventKey NULL — they are a deliberate
-- "legacy archive" (see notification-center.service.ts): still present for
-- audit, but NotificationCenterService.list() excludes recipientId IS NULL
-- rows from now on, since no single member is the rightful owner of a
-- pre-migration workspace-wide row.

ALTER TABLE "notifications" ADD COLUMN "recipientId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "eventKey" TEXT;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notifications_recipientId_idx" ON "notifications"("recipientId");

-- Dedup: a cron producer may call createTx() every tick for the same
-- (recipient, event) — the second call hits this unique index (P2002) and
-- is treated as a no-op instead of inserting a duplicate. Partial so legacy
-- rows (both NULL) and one-off notifications without an eventKey are exempt.
CREATE UNIQUE INDEX "notifications_recipient_event_key"
  ON "notifications"("recipientId", "eventKey")
  WHERE "recipientId" IS NOT NULL AND "eventKey" IS NOT NULL;

-- Tighten RLS: an addressed row (recipientId set) is visible only to that
-- recipient — even a fellow workspace member can no longer see it via a
-- forgotten app-level filter. A legacy row (recipientId NULL) keeps the old
-- membership-wide visibility, since it was never addressed to one person.
DROP POLICY IF EXISTS notifications_isolation ON "notifications";
CREATE POLICY notifications_isolation ON "notifications" USING (
  CASE
    WHEN "recipientId" IS NOT NULL THEN "recipientId" = current_setting('app.current_user_id', true)
    ELSE EXISTS (
      SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "notifications"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  END
);
