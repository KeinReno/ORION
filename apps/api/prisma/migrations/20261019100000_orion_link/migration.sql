-- ADR-0020 (Orion Link): спаренные устройства и ключи пакетов облачного ящика.
CREATE TABLE "link_devices" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "link_devices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "link_devices_workspaceId_idx" ON "link_devices"("workspaceId");
CREATE INDEX "link_devices_userId_idx" ON "link_devices"("userId");
ALTER TABLE "link_devices" ADD CONSTRAINT "link_devices_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "link_devices" ADD CONSTRAINT "link_devices_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "link_keys" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    CONSTRAINT "link_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "link_keys_workspaceId_keyId_key" ON "link_keys"("workspaceId", "keyId");
CREATE INDEX "link_keys_workspaceId_idx" ON "link_keys"("workspaceId");
ALTER TABLE "link_keys" ADD CONSTRAINT "link_keys_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS. Устройство видит и меняет только свой пользователь-владелец (и только пока он член пространства);
-- ключи читает/пишет только владелец пространства. Узел (фоновый приём пакетов) идёт через asSystem.
ALTER TABLE "link_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "link_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY link_devices_isolation ON "link_devices"
  USING ("userId" = current_setting('app.current_user_id', true)
    AND EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "link_devices"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)));

ALTER TABLE "link_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "link_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY link_keys_owner ON "link_keys"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "link_keys"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true) AND wm."role" = 'owner'));
