-- U09 (docs/SONNET_IMPLEMENTATION/27-U09-THREAT-MODEL.md) — cross-workspace
-- grants RLS.
--
-- 1) `cross_workspace_grants` itself gets the usual ENABLE + FORCE + a
--    single policy, but the policy is NOT the flat membership check every
--    other table uses (`lists_isolation` pattern) — a grantee is, by
--    definition, never a member of the source workspace. A row is visible
--    to (a) a member/owner of the source workspace (so the owner UI can
--    list/manage grants they issued) OR (b) the grantee themself (so
--    `GET /shared` can list "what's shared with me" via an ordinary
--    `withUser` transaction, no special GUC needed for the grant *record*
--    itself — only for reading the *target object* through it, see below).
--
-- 2) Four ADDITIVE `FOR SELECT` policies on the target tables
--    (projects/notes/documents/finance_transactions) — one per allowlisted
--    objectType. Each is a second permissive policy alongside the existing
--    `*_isolation` policy (Postgres OR's permissive policies together for
--    the same command automatically) and is conditioned on BOTH:
--      - a live, matching CrossWorkspaceGrant row (revokedAt IS NULL,
--        expiresAt NULL or in the future, granteeUserId = current user), AND
--      - `current_setting('app.active_grant_id', true)` equals that grant's
--        id.
--    The second condition is the point (T4 in the threat model): without it,
--    Postgres would apply the grant-read policy on ANY select against these
--    tables, including the ordinary `workspaces/:id/projects/:id` endpoint,
--    silently widening membership-only access. `app.active_grant_id` is set
--    ONLY inside `PrismaService.withGrant`, which only `SharedService` calls
--    — never a normal `withUser` transaction — so this branch can never
--    fire outside the narrow grant-aware read path.
--
-- INSERT/UPDATE/DELETE are untouched: these are `FOR SELECT` only, so
-- mutating routes keep exactly the membership check they had before (T5,
-- read-only-only).

ALTER TABLE "cross_workspace_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cross_workspace_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY cross_workspace_grants_isolation ON "cross_workspace_grants"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    OR "cross_workspace_grants"."granteeUserId" = current_setting('app.current_user_id', true)
  );

CREATE POLICY projects_grant_read ON "projects"
  FOR SELECT
  USING (
    current_setting('app.active_grant_id', true) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "cross_workspace_grants" g
      WHERE g."id" = current_setting('app.active_grant_id', true)
        AND g."objectType" = 'project'
        AND g."objectId" = "projects"."id"
        AND g."granteeUserId" = current_setting('app.current_user_id', true)
        AND g."revokedAt" IS NULL
        AND (g."expiresAt" IS NULL OR g."expiresAt" > now())
    )
  );

CREATE POLICY notes_grant_read ON "notes"
  FOR SELECT
  USING (
    current_setting('app.active_grant_id', true) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "cross_workspace_grants" g
      WHERE g."id" = current_setting('app.active_grant_id', true)
        AND g."objectType" = 'note'
        AND g."objectId" = "notes"."id"
        AND g."granteeUserId" = current_setting('app.current_user_id', true)
        AND g."revokedAt" IS NULL
        AND (g."expiresAt" IS NULL OR g."expiresAt" > now())
    )
  );

CREATE POLICY documents_grant_read ON "documents"
  FOR SELECT
  USING (
    current_setting('app.active_grant_id', true) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "cross_workspace_grants" g
      WHERE g."id" = current_setting('app.active_grant_id', true)
        AND g."objectType" = 'document'
        AND g."objectId" = "documents"."id"
        AND g."granteeUserId" = current_setting('app.current_user_id', true)
        AND g."revokedAt" IS NULL
        AND (g."expiresAt" IS NULL OR g."expiresAt" > now())
    )
  );

CREATE POLICY finance_transactions_grant_read ON "finance_transactions"
  FOR SELECT
  USING (
    current_setting('app.active_grant_id', true) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "cross_workspace_grants" g
      WHERE g."id" = current_setting('app.active_grant_id', true)
        AND g."objectType" = 'transaction'
        AND g."objectId" = "finance_transactions"."id"
        AND g."granteeUserId" = current_setting('app.current_user_id', true)
        AND g."revokedAt" IS NULL
        AND (g."expiresAt" IS NULL OR g."expiresAt" > now())
    )
  );
