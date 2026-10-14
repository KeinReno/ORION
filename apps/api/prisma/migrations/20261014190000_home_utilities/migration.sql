CREATE TABLE "home_utility_months" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "rentMinor" INTEGER NOT NULL DEFAULT 0,
  "rentConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "charges" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "home_utility_months_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "home_utility_months_homeId_period_key" ON "home_utility_months"("homeId", "period");
CREATE INDEX "home_utility_months_workspaceId_homeId_period_idx" ON "home_utility_months"("workspaceId", "homeId", "period");
ALTER TABLE "home_utility_months" ADD CONSTRAINT "home_utility_months_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_utility_months" ADD CONSTRAINT "home_utility_months_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "home_electricity_tariffs" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "meterId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "rateRub" DECIMAL(12,4) NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "home_electricity_tariffs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "home_electricity_tariffs_meterId_effectiveFrom_key" ON "home_electricity_tariffs"("meterId", "effectiveFrom");
CREATE INDEX "home_electricity_tariffs_workspaceId_meterId_idx" ON "home_electricity_tariffs"("workspaceId", "meterId");
ALTER TABLE "home_electricity_tariffs" ADD CONSTRAINT "home_electricity_tariffs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_electricity_tariffs" ADD CONSTRAINT "home_electricity_tariffs_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "home_utility_months" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "home_utility_months" FORCE ROW LEVEL SECURITY;
CREATE POLICY home_utility_months_isolation ON "home_utility_months"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "home_utility_months"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));

ALTER TABLE "home_electricity_tariffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "home_electricity_tariffs" FORCE ROW LEVEL SECURITY;
CREATE POLICY home_electricity_tariffs_isolation ON "home_electricity_tariffs"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "home_electricity_tariffs"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));
