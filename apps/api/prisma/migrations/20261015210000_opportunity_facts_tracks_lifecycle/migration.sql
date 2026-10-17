-- Lifecycle of profile facts and tracks: soft archive (never delete evidence) and optimistic concurrency for tracks.
-- Additive only: existing rows get archivedAt NULL, revision 0, updatedAt = createdAt. RLS policies are unchanged.
ALTER TABLE "opportunity_facts" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "opportunity_tracks" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "opportunity_tracks" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "opportunity_tracks" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "opportunity_tracks" SET "updatedAt" = "createdAt";
ALTER TABLE "opportunity_tracks" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "opportunity_tracks" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
