# ADR-0038 — Manual MCP execution lease bridge (PROPOSED)

**Date:** 2026-10-29  
**Status:** F2 draft, stacked on ADR-0037. Integration tests written, not yet executed.

## Decision

Expose exactly three optional Agent Hub tools through the existing generated MCP registry:

- `orion_agent_hub_queue` — list only queued work and the authenticated token's own claimed/working work.
- `orion_agent_hub_claim` — claim a queued execution via bounded 120-second server lease.
- `orion_agent_hub_report` — start, heartbeat, checkpoint, submit evidence, block or fail; cannot verify or mark done.

Each write flows through AgentTokenGuard → AgentModuleToolsService → workspace RLS → project-fenced TaskIntegrationReader → deterministic transition policy → CAS update + append-only event in the **same transaction**. The server derives the worker identity from the authenticated `AgentContext.tokenId`, never from request body, and assigns clock/lease length. Token project allowlists and `tasks:read` must hold even when the token has Agent Hub module permissions. The relevant Tasks module must also be enabled.

`modulePermissions: [agent-hub.execution.read, agent-hub.execution.create]` gates the tools. The `create` effect is used for operational execution receipts and counts against the agent's write budget; it does **not** grant direct mutation of the user Task. It is an explicit exception to the ordinary user-content update/proposal workflow and must remain limited to the execution protocol.

## Safety and liveness

A claim records the logical token as worker and `manual-mcp:<tokenId>` as runtime descriptor; this is **not** a process/session attestation. Heartbeat proves only a successful tool call at that instant.

Only an owner/lead can invoke `POST /workspaces/:workspaceId/agent-hub/reconcile`, which moves expired claimed/working leases back to queued via authoritative server time, preserving the checkpoint. A second worker can claim the new revision; the old worker's reports fail. There is no scheduler; an expired lease is not automatically recovered until reconcile is called.

The user-facing API can cancel with CAS; workers cannot cancel, requeue, verify, alter another worker's lease, grant privileges or launch an IDE. A submitted evidence reference is untrusted metadata. It sets execution to review and does **not** close the execution or user Task. Actual artifact verification and owner approval require a separate trusted service.

## Required tests and limitations

Test: project fence, missing tasks read scope, observer denial, competing claim, stale revision, wrong token, lease expiry, persisted checkpoint, explicit requeue, immutable submitted state, disabled-module access and token revocation. Test source in `apps/api/test/modules-ext/agent-hub/agent-hub-agent.integration.test.ts`.

CI, DB migration and Windows manual MCP smoke have not been run in the connector environment. This draft must not be merged until checks are run and all failures addressed.
