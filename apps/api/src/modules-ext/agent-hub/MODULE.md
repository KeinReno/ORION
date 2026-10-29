# Agent Hub module

Optional module for persistent execution attempts. First wave stores queue records, events and cancellation; no autonomous executor is enabled.

- Source of user tasks: Tasks public reader; never duplicate task body or mutate Tasks directly.
- Existing AI Bridge still owns messages, tokens, scopes, proposals and agent audit.
- Agent Hub owns only `AgentHubExecution` and `AgentHubEvent`.
- Workspace isolation: `withUser` + membership, database FORCE RLS.
- Owner/lead-only writes, CAS cancellation and a journal row in the same transaction.
- No user-supplied claim, heartbeat or verify endpoint before a trusted coordinator exists.
- Snapshot policy: both executions and events included, in that order.
- Runtime unavailable means `queued`, never `online`; manual MCP remains distinct.
- Disabling the module preserves all records.

See `docs/adr/ADR-0036-agent-hub-execution-foundation.md` and `docs/agent-hub/ROADMAP.md`.

<!-- generated:manifest:start -->
<!-- generated:manifest:end -->
