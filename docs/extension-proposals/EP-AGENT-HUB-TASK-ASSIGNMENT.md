# Extension Proposal — stable Agent Hub profiles and task assignments

**Status:** proposed; implementation in this working tree is a reviewable first vertical slice.  
**Date:** 2026-11-10  
**Owners:** Agent Hub, AI Bridge, Tasks public bridge.

## Problem

Tasks can be assigned to workspace members through the optional `team` plugin. Agent Hub executions are separate attempts and Agent Tokens are credentials, not persistent agent identities. A task therefore cannot safely name a particular AI agent as its executor today.

## Proposal

Agent Hub owns stable, workspace-scoped `AgentHubAgentProfile` identities and one current `AgentHubTaskAssignment` per task. A profile is created by a workspace owner/lead who explicitly binds one or more of their own live AI Bridge credentials. Credentials remain owned by AI Bridge; a public, read-only credential reader exposes only the current user's eligible credential IDs, names, scopes and expiry. Names alone never merge profiles or credentials.

Agent Hub assignment refers to a profile ID, never a token or runtime session. Setting an assignment does not create `AgentHubExecution`, claim work, launch an IDE, or dispatch a message. Execution remains an explicit separate action.

Tasks and Agent Hub use the public `TaskAgentAssignmentRegistry` bridge. Both paths lock the canonical Task row with `SELECT ... FOR UPDATE` before checking the other assignment type, so a human member and an agent profile cannot win concurrently. Each module writes only its own records.

## Data and restore

- `AgentHubAgentProfile` is included in workspace snapshots.
- `AgentHubTaskAssignment` is included and retains its profile reference and assigning user.
- `AgentHubAgentCredential` is secret-excluded; restoration never restores credential authority.
- After restore, profiles and task assignments remain visible with `credentialStatus: "missing"`. An owner/lead must explicitly rebind a fresh eligible credential to the same profile.
- Task IDs are references validated through the Tasks public reader. If a task is hard-deleted, the assignment row remains as history and cannot be read as a live assignment because GET verifies that the task still exists.

## HTTP contract

- `GET /workspaces/:workspaceId/agent-hub/agents` returns `{ agents: AgentHubAgentProfile[] }` for the current user's profiles; each profile includes `credentialStatus` (`active`, `revoked`, `expired`, `missing`).
- `GET /workspaces/:workspaceId/agent-hub/agent-credentials` returns `{ credentials: AgentHubCredentialOption[] }`, limited to the current user's eligible credentials; secrets and token hashes are never returned.
- `POST /workspaces/:workspaceId/agent-hub/agents` accepts `{ name, credentialIds }` and returns the created `AgentHubAgentProfile`.
- `PUT /workspaces/:workspaceId/agent-hub/agents/:agentId/credentials` accepts `{ credentialIds }` and replaces that profile's bindings, returning `AgentHubAgentProfile`.
- `GET /workspaces/:workspaceId/agent-hub/task-assignments/:taskId` returns `{ workspaceId, taskId, agent: { id, name } | null, credentialStatus, updatedAt }`. Status is `unavailable` when the viewer is not the profile owner; this avoids exposing another member's credential state.
- `PUT /workspaces/:workspaceId/agent-hub/task-assignments/:taskId` accepts `{ agentId: string | null }`; null clears the assignment and the response has the same shape as GET.

Reads require workspace membership and enabled Tasks/Agent Hub modules. Writes require `agent-hub.execution.create` or `.update`, workspace owner/lead, a profile created by the acting user, and currently eligible credentials created by that same user. The credential link is unique across profiles.

## Acceptance

1. A caller cannot list, bind, or assign another workspace member's token.
2. Revocation/expiry leaves profile and assignment visible, while preventing a new assignment or execution claim under that profile.
3. A restored profile/assignment survives while credential bindings do not; explicit rebind restores availability without creating a duplicate profile.
4. Concurrent human and agent assignment to one task serialize on the Task row; at most one succeeds.
5. Assignment alone creates no Agent Hub execution and triggers no runtime action.

## Limits of this slice

The API does not automatically infer which credentials represent one agent. A human must create the profile and choose its credentials. Runtime/session identity, provider/model attribution, autonomous dispatch and completion verification remain outside this proposal.
