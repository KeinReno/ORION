# ADR-0047 — Agent connection and owner-controlled lifetime

Status: Accepted for the owner-requested integration of PR #96 into Windows beta.37, 2026-11-03. Supersedes forced remote token lifetime/mode restrictions in historical ADR-0017, whose new dated note records the upstream product decision.

Keep ORION DEV from beta.36. Integrate PR #96 HEAD `84bb0dc80b0fcb6164febb2d54b3810bea30a941` on the local beta branch, without merging master or unrelated XLSX PR #94. Automatic client configuration remains loopback-only, JSON-only, local-node-owner gated. Admin credentials additionally require the current workspace owner, at issuance/edit and authentication. Existing scope ceilings and serialized policy edits from the stabilization branch remain intact.

Users explicitly select mode/lifetime (1–36500 days or no expiry). Omitted lifetime now defaults to no expiry in create/install; existing stored expirations are unchanged. PATCH expiry renews from the current time or removes expiry, with policy audit. Server location no longer silently adds delete-forbids or TTL caps. Revocation and membership/role checks remain authoritative. This is an intentional behavior decision, not an accidental removal of validation.

AgentGateway contract 1.1.0 / Platform API 1.13.0. Routes remain /ai/v1. The install request adds mode/expiry, PATCH token adds expiry, and install result adds apiVerified. The application ships API and frontend together in a full installer; mixing a new frontend with an old API is not a supported deployment. Database schema unchanged.

The installer issues a credential, verifies it through real loopback /ai/v1/me with redirects refused, and then atomically replaces a private token file and client config, preserving other MCP entries. REST auth is not proof that a running MCP client reloaded configuration. The user must restart that client; actual adapter tool calls are checked separately. No real user MCP config or tokens are modified by automated tests.

Integration fixes: serialize installs per client-config path in the local API (including separate service instances); reject external edits observed during the auth handshake; restore previous credential and revoke new token after write failure. Full TOML parsing and semantic comparison protect unrelated settings/multiline text. Unsupported layouts fail closed for manual configuration. Temporary files are removed on failure. Concurrent independent OS processes are not claimed to share this in-memory lock.

Token files use POSIX 0600 or inherited Windows profile ACLs; there is no DPAPI encryption. Existing config backups can contain an older credential from previous releases, so they are private and the replaced credential is revoked only after successful writes. No secret is returned by automatic install or included in error logs. Test profiles and Windows ACL evidence are distinct from actual Codex restart acceptance.
