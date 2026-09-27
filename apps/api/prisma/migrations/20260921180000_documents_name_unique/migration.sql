-- S14c: close a TOCTOU race in DocumentsService (upload/update/restore all
-- only checked `assertNameFreeTx` in application code before writing to
-- disk). Two concurrent requests that both pass the pre-check for the same
-- (workspaceId, parentId, name) each moved a blob to the same on-disk key —
-- last writer wins on disk, but BOTH document rows kept pointing at that
-- single key, so one of them silently lost its content with no error to the
-- user. This partial, case-insensitive, NULL-safe unique index makes the DB
-- itself reject the second writer (P2002), matching the case-insensitive
-- semantics `assertNameFreeTx` already uses (`mode: "insensitive"`) and
-- treating a `parentId IS NULL` (workspace root) consistently instead of
-- Postgres's default "every NULL is distinct" behavior for plain UNIQUE.
CREATE UNIQUE INDEX "documents_workspace_parent_name_ci_key"
  ON "documents" (
    "workspaceId",
    COALESCE("parentId", '00000000-0000-0000-0000-000000000000'),
    lower("name")
  )
  WHERE "deletedAt" IS NULL;
