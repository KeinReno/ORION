-- A library item may optionally be referenced from one project. No project is required.
ALTER TABLE "knowledge_items" ADD COLUMN "projectId" TEXT;
CREATE INDEX "knowledge_items_projectId_idx" ON "knowledge_items"("projectId");
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
