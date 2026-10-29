# Agent Hub — AI context

Read this module's MODULE.md, docs/AGENT_HUB_ARCHITECTURE.md and ADR-0036.
This is a registered but NOT AUTONOMOUS module. No IDE launches, scheduler
or agent-to-agent dispatch exists in this wave. Do not conflate Task status,
AgentJob status and the execution state machine.

Server code calls TaskIntegrationReader through its public module, never Tasks
internals. Model code must not infer an online runtime from token presence.

<!-- generated:manifest:start -->
<!-- generated:manifest:end -->
