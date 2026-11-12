-- Foundation Core (task 01): EntityLink gets a closed kind enum, an explicit bidirectional
-- flag for symmetric kinds and the creator for the audit trail. EntityLink stays a core model.

CREATE TYPE "EntityLinkKind" AS ENUM (
  'related_to', 'supports', 'evidence_for',
  'goal_step', 'goal_measure', 'goal_material', 'goal_risk', 'goal_prerequisite',
  'blocks', 'depends_on', 'relates_to', 'continues', 'replaces', 'duplicates', 'references'
);

ALTER TABLE "entity_links" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "entity_links" ALTER COLUMN "kind" TYPE "EntityLinkKind" USING ("kind"::text::"EntityLinkKind");
ALTER TABLE "entity_links" ALTER COLUMN "kind" SET DEFAULT 'related_to'::"EntityLinkKind";

ALTER TABLE "entity_links" ADD COLUMN "bidirectional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "entity_links" ADD COLUMN "createdById" TEXT;

CREATE INDEX "entity_links_workspaceId_createdAt_idx" ON "entity_links" ("workspaceId", "createdAt");
