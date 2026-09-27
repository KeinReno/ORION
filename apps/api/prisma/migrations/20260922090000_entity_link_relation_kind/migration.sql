-- U01 (24-CONNECTED-CORE-BACKLOG.md): typed relation-kind catalog for EntityLink.
-- Existing rows are untyped free-form links created before this catalog
-- existed; they backfill to "related_to" (the symmetric, no-op-safe default)
-- rather than being reinterpreted as a directed kind we cannot infer.
ALTER TABLE "entity_links" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'related_to';

-- The old unique index only covered the four endpoint columns, which is now
-- too strict: a directed kind (e.g. evidence_for) must be able to coexist
-- with a symmetric related_to link on the same (source,target) pair.
DROP INDEX IF EXISTS "entity_links_sourceType_sourceId_targetType_targetId_key";
CREATE UNIQUE INDEX "entity_links_sourceType_sourceId_targetType_targetId_kind_key"
  ON "entity_links" ("sourceType", "sourceId", "targetType", "targetId", "kind");
