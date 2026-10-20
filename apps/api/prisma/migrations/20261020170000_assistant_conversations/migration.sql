-- История бесед со встроенным ассистентом: личная, в пределах пространства.
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_conversations_workspaceId_userId_updatedAt_idx" ON "assistant_conversations"("workspaceId", "userId", "updatedAt");

ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Беседа видна только её автору и только пока он участник пространства (личная переписка с моделью, как assistant_keys).
ALTER TABLE "assistant_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_conversations_owner ON "assistant_conversations"
  USING (
    "userId" = current_setting('app.current_user_id', true)
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "assistant_conversations"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    "userId" = current_setting('app.current_user_id', true)
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "assistant_conversations"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  );
