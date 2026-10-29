# Agent Hub — local AI context

Read docs/PLATFORM.md, ORION_CONSTITUTION.md, docs/AI_REFACTOR_MIGRATION_MAP.md,
docs/AGENT_HUB_ARCHITECTURE.md and docs/agent-hub/MODULE.md before modifying this area.

Only stable public types are imported from @orion/shared-types. Do not wire
Agent Hub directly to apps/api/src/ai/agent-jobs.service.ts; create an explicit
Agent Jobs public bridge with workspace membership and scope checks.

The transition function is a POLICY, not an authorization boundary. The
registered module now persists executions and events, and the manual MCP
adapter and Habitat observer have been implemented. Their server operations
must continue to:
- revalidate actor identity, workspace, token mode and capability on the server;
- atomically compare expected revision and append an audit event;
- treat a reported runtime session as a TTL report, never process attestation;
- allow at most one live lease; reclaim expired leases via the trusted coordinator;
- preserve evidence and checkpoints when a runtime disconnects;
- separate worker and reviewer and never auto-complete from a model message;
- keep customer data, tokens and conversation content out of GitHub relay payloads.

The current local integration branch passed migrations and targeted API tests
against an isolated database. Snapshot restore, Windows host containment,
provider CLI adapters and autonomous execution remain unverified or absent.
