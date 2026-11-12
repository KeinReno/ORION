-- Agent memory: user memory written by an agent is private to that agent profile.
-- The active-key index therefore includes the writing profile, so two agents of the
-- same human may keep the same key without one silently superseding the other.

DROP INDEX "agent_memory_records_active_key";
CREATE UNIQUE INDEX "agent_memory_records_active_key"
  ON "agent_memory_records"("workspaceId", "scope", COALESCE("scopeId", ''), COALESCE("agentId", ''), "key")
  WHERE "validity" = 'valid';
