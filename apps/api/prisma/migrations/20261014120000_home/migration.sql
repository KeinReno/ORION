-- Module «Дом»: homes, meters with readings, contacts; nullable homeId on chores, lists, things, payments.
CREATE TABLE "homes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'flat',
    "note" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "homes_workspaceId_name_key" ON "homes"("workspaceId", "name");
CREATE INDEX "homes_workspaceId_idx" ON "homes"("workspaceId");
ALTER TABLE "homes" ADD CONSTRAINT "homes_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "meters" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "unit" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meters_workspaceId_idx" ON "meters"("workspaceId");
CREATE INDEX "meters_homeId_idx" ON "meters"("homeId");
ALTER TABLE "meters" ADD CONSTRAINT "meters_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meters" ADD CONSTRAINT "meters_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "meter_readings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meter_readings_workspaceId_idx" ON "meter_readings"("workspaceId");
CREATE INDEX "meter_readings_meterId_readAt_idx" ON "meter_readings"("meterId", "readAt");
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meterId_fkey"
  FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "contacts_workspaceId_idx" ON "contacts"("workspaceId");
CREATE INDEX "contacts_homeId_idx" ON "contacts"("homeId");
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pointers from the other modules (SetNull: deleting a home keeps the chore, list, thing and payment).
ALTER TABLE "tasks" ADD COLUMN "homeId" TEXT;
ALTER TABLE "lists" ADD COLUMN "homeId" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN "homeId" TEXT;
ALTER TABLE "finance_obligations" ADD COLUMN "homeId" TEXT;
CREATE INDEX "tasks_homeId_idx" ON "tasks"("homeId");
CREATE INDEX "lists_homeId_idx" ON "lists"("homeId");
CREATE INDEX "inventory_items_homeId_idx" ON "inventory_items"("homeId");
CREATE INDEX "finance_obligations_homeId_idx" ON "finance_obligations"("homeId");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lists" ADD CONSTRAINT "lists_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_obligations" ADD CONSTRAINT "finance_obligations_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every table with "workspaceId" needs ENABLE + FORCE RLS and a policy.
ALTER TABLE "homes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "homes" FORCE ROW LEVEL SECURITY;
CREATE POLICY homes_isolation ON "homes"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "homes"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));

ALTER TABLE "meters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meters" FORCE ROW LEVEL SECURITY;
CREATE POLICY meters_isolation ON "meters"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "meters"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));

ALTER TABLE "meter_readings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meter_readings" FORCE ROW LEVEL SECURITY;
CREATE POLICY meter_readings_isolation ON "meter_readings"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "meter_readings"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY contacts_isolation ON "contacts"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "contacts"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));
