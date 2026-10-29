# Agent Hub — local AI context

Read docs/PLATFORM.md, ORION_CONSTITUTION.md, docs/AI_REFACTOR_MIGRATION_MAP.md,
docs/AGENT_HUB_ARCHITECTURE.md and docs/agent-hub/MODULE.md before modifying this area.

Only stable public types are imported from @orion/shared-types. Do not wire
Agent Hub directly to apps/api/src/ai/agent-jobs.service.ts; create an explicit
Agent Jobs public bridge with workspace membership and scope checks.

The pure transition function is a POLICY, not an authorization boundary.
Any future persistence implementation MUST:
- revalidate actor identity, workspace, token mode and capability on the server;
- atomically compare expected revision and append an audit event;
- verify that claimed runtime is online instead of inferring presence from a token;
- allow at most one live lease; reclaim expired leases via the trusted coordinator;
- preserve evidence and checkpoints when a runtime disconnects;
- separate worker and reviewer and never auto-complete from a model message;
- keep customer data, tokens and conversation content out of GitHub relay payloads.

Do not claim the feature is active until manifest, migrations, integrations,
restoration and runtime smoke tests have been verified on the current HEAD.
