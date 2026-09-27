-- Row Level Security for "note_revisions" — same flat workspace-membership
-- check as every other workspace-scoped table. FORCE because the "orion"
-- role owns the table and owners bypass RLS by default.

ALTER TABLE "note_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY note_revisions_isolation ON "note_revisions"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "note_revisions"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
