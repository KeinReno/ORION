-- CreateTable
CREATE TABLE "shared_publications" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceWorkspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "includeText" BOOLEAN NOT NULL DEFAULT false,
    "includeDueAt" BOOLEAN NOT NULL DEFAULT false,
    "allowStatus" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_publication_pins" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_publication_pins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_publication_operations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_publication_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_publications_workspaceId_revokedAt_idx" ON "shared_publications"("workspaceId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shared_publication_pins_userId_workspaceId_publicationId_key" ON "shared_publication_pins"("userId", "workspaceId", "publicationId");

-- CreateIndex
CREATE INDEX "shared_publication_operations_publicationId_createdAt_idx" ON "shared_publication_operations"("publicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "shared_publications" ADD CONSTRAINT "shared_publications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_publications" ADD CONSTRAINT "shared_publications_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_publication_pins" ADD CONSTRAINT "shared_publication_pins_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_publication_pins" ADD CONSTRAINT "shared_publication_pins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_publication_pins" ADD CONSTRAINT "shared_publication_pins_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "shared_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_publication_operations" ADD CONSTRAINT "shared_publication_operations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_publication_operations" ADD CONSTRAINT "shared_publication_operations_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "shared_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_publication_operations" ADD CONSTRAINT "shared_publication_operations_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE UNIQUE INDEX "shared_publications_active_source" ON "shared_publications" ("workspaceId", "publisherId", "kind", "sourceId") WHERE "revokedAt" IS NULL;
ALTER TABLE "shared_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shared_publications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "shared_publications_access" ON "shared_publications" USING (
  "publisherId" = current_setting('app.current_user_id', true) OR
  ("revokedAt" IS NULL AND EXISTS (SELECT 1 FROM workspace_members m WHERE m."workspaceId" = "shared_publications"."workspaceId" AND m."userId" = current_setting('app.current_user_id', true)))
) WITH CHECK (
  "publisherId" = current_setting('app.current_user_id', true) OR
  EXISTS (SELECT 1 FROM workspace_members m WHERE m."workspaceId" = "shared_publications"."workspaceId" AND m."userId" = current_setting('app.current_user_id', true))
);
ALTER TABLE "shared_publication_pins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shared_publication_pins" FORCE ROW LEVEL SECURITY;
CREATE POLICY "shared_publication_pins_access" ON "shared_publication_pins" USING (
  "userId" = current_setting('app.current_user_id', true) AND EXISTS (SELECT 1 FROM workspace_members m WHERE m."workspaceId" = "shared_publication_pins"."workspaceId" AND m."userId" = current_setting('app.current_user_id', true))
) WITH CHECK (
  "userId" = current_setting('app.current_user_id', true) AND EXISTS (SELECT 1 FROM workspace_members m WHERE m."workspaceId" = "shared_publication_pins"."workspaceId" AND m."userId" = current_setting('app.current_user_id', true))
);
ALTER TABLE "shared_publication_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shared_publication_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "shared_publication_operations_access" ON "shared_publication_operations" USING (
  EXISTS (SELECT 1 FROM shared_publications p WHERE p.id = "shared_publication_operations"."publicationId")
) WITH CHECK (
  EXISTS (SELECT 1 FROM shared_publications p WHERE p.id = "shared_publication_operations"."publicationId")
);
GRANT SELECT, INSERT, UPDATE, DELETE ON shared_publications, shared_publication_pins, shared_publication_operations TO orion_app, orion_system;

-- Restore may affect publications in zones the restoring source owner cannot see.
-- Narrow definer function: only revocation, only for a workspace currently owned by the actor.
CREATE FUNCTION public.revoke_publications_from_source(source_workspace_id TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members m
    WHERE m."workspaceId" = source_workspace_id AND m."userId" = current_setting('app.current_user_id', true) AND m.role = 'owner') THEN
    RAISE EXCEPTION 'Source workspace owner required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.shared_publications SET "revokedAt" = now(), revision = revision + 1, "updatedAt" = now()
    WHERE "sourceWorkspaceId" = source_workspace_id AND "revokedAt" IS NULL;
END;
$$;
ALTER FUNCTION public.revoke_publications_from_source(TEXT) OWNER TO orion_system;
REVOKE ALL ON FUNCTION public.revoke_publications_from_source(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_publications_from_source(TEXT) TO orion_app, orion_system;
