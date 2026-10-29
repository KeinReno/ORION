# ADR-0039 — KAIDEN Habitat local process host (PROPOSED)

**Date:** 2026-10-29  
**Status:** Prototype in `feature/kaiden-habitat-f3-local-host-20261029`; no Agent Hub wiring, no Windows installer.  
**Parent decisions:** ADR-0036 execution, ADR-0037 durable queue, ADR-0038 manual MCP.

## Decision

Introduce a separate `packages/habitat` Node.js package as an **opt-in local operator tool**. Habitat is an adapter below Agent Hub, not a new Tasks database and not part of the API/Core. Do not grant model messages a code-execution right as a side effect of having an Agent Gateway token.

First working boundary:

1. Load locally created versioned JSON config, with `enabled=false` by default in the documented example.
2. `probe` checks approved binary paths without invoking them; it never claims a valid provider login, license or subscription.
3. `run` requires an exact approved profile, an allowed real filesystem workdir, a nonempty bounded task file, a human CLI acknowledgement and a local `config.enabled=true`.
4. The executable and static argv come **only from the operator's local config**, not from an Agent Task body, MCP payload or remote call. Spawn uses `shell:false`; the task is passed over stdin, not as a shell command.
5. The child inherits only a small allowlist of environment variables for local execution. API keys/agent tokens are not forwarded by default.
6. Exit status, timeout, user cancellation, output hashes and counts are persisted in a versioned local receipt; no raw stdout/stderr or transcripts are stored. `verified=false` is explicit. No automatic Agent Hub `done` transition occurs.
7. The package does not start at boot, register a service, accept HTTP requests, call ChatGPT directly or launch any unapproved provider.

## Security limitations / constraints before unattended execution

This is NOT an OS sandbox. A trusted CLI runs with the current user's file and network rights and may spawn its own children. Path containment on task input and cwd does not contain the launched process's access to other files. An agent must not be able to edit the approved configuration, choose the executable or expand the argument vector through a message.

Windows process-tree cancellation remains insufficient with Node `child.kill` alone. Unattended Windows mode requires Windows Job Objects (or equivalent owned-process group supervision), a dedicated low-privilege OS identity or stronger sandboxing, worktree isolation, profile-signing/approval revocation, runtime heartbeat and a crash-recovery reconciliation protocol.

Provider adapters (Codex CLI, Claude Code CLI, Cursor) must verify their official current flags, login methods, subscription compatibility and automation rules separately. Detection alone is not proof of authorization or API-free operation.

## Tests and observability

`node --test packages/habitat/test/*.test.mjs` tests denial without opt-in, profile approval, realpath/symlink escape, probe without launch, local approved Node execution, hash-only receipt, deadline termination and operator cancellation. Six local Node tests were executed successfully on Linux Node v22; **not** a Windows acceptance test and **not** a repository-wide typecheck.

The existing Agent Hub F2 claims are token-bound manual-MCP. They remain separate from this runtime package. Linking them requires a mutually authenticated local bridge whose credentials and scope are provisioned by a human, not a bearer token copied into a generic runtime environment.

## Follow-up gates

- Native Windows process-tree termination and low-privilege execution.
- Explicit operator UI/service installer, process identity and per-repo allowance.
- Versioned runtime handshake with F2; source event and checkpoint attribution.
- Replay-safe lease renewal/recovery and dedicated instance identity (not just tokenId).
- Actual result/artifact verification independent of the performing model.
- Manual Windows install and smoke tests before PR approval.
