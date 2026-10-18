-- ADR-0019 / G3: transactional outbox of domain events and per-subscriber deliveries.

CREATE TABLE "domain_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_event_deliveries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "domain_event_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "domain_events_workspaceId_idx" ON "domain_events"("workspaceId");
CREATE INDEX "domain_events_dispatchedAt_createdAt_idx" ON "domain_events"("dispatchedAt", "createdAt");
CREATE UNIQUE INDEX "domain_event_deliveries_eventId_subscriberId_key" ON "domain_event_deliveries"("eventId", "subscriberId");
CREATE INDEX "domain_event_deliveries_workspaceId_idx" ON "domain_event_deliveries"("workspaceId");
CREATE INDEX "domain_event_deliveries_status_nextAttemptAt_idx" ON "domain_event_deliveries"("status", "nextAttemptAt");

ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_event_deliveries" ADD CONSTRAINT "domain_event_deliveries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_event_deliveries" ADD CONSTRAINT "domain_event_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "domain_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same membership-based guard as every workspace table. Users only ever INSERT events (publishTx) in their own
-- workspace; the dispatcher reads and updates them as orion_system.
ALTER TABLE "domain_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_events_isolation ON "domain_events" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "domain_events"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "domain_event_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_event_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_event_deliveries_isolation ON "domain_event_deliveries" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "domain_event_deliveries"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));
