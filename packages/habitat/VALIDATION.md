# Habitat F3 — local host validation checklist

This file tracks `packages/habitat` and does not replace the Agent Hub roadmap.

**Implemented in branch:** local disabled-by-default configuration example, static approved executable profiles, filesystem root and task-file validation, no-shell spawn, explicit operator acknowledgment, limited runtime and receipt hashing, probe, CLI, Node tests, and a human-invoked loopback F2 bridge with claim/start/heartbeat/report and fail-closed authorization.

**Not yet implemented:** Windows Job Objects, secure process isolation, Windows packaging/service, auto-start, provider-specific Codex/Claude CLI adapters, attested runtime identity, production-grade persistent leases, provider authentication diagnostics, independent artifact verification, autonomous task dispatch.

**Local check (2026-10-29):** Node v22 `node --test packages/habitat/test/*.test.mjs`: 12 passed, 0 failed on Linux. The entire ORION monorepo and Windows device were not exercised.

**Merge gates:** package tests on Windows, full `pnpm typecheck`, `pnpm lint`, `pnpm test`, architecture checks, F0–F2 tests and migrated DB integration tests. No secrets or local personal paths in Git.

**F3 observation supervisor (draft):** local-only session id and state, atomic observation updates, exclusive lock, explicit opt-in, loopback GET queue, no autonomous claim. 8 isolated Node v22 unit tests pass with stub imports/mock HTTP. Windows service and ORION-integrated checks still outstanding. See SUPERVISOR.md and ADR-0040.

**F3d isolated Node checks (2026-10-29):** 14 passing tests, 0 failing on Node v22/Linux using mocked F2/F3c HTTP and lightweight local dependency stubs. They cover runtime register/pulse/close, registration refusal, denial of remote HTTP and status persistence. Full ORION/database/Windows checks have not run.

**Windows integration pass (2026-10-29/30):** 26 Node tests passed on Windows with the actual package. The three Agent Hub API integration files passed (13 tests) against an isolated migrated PostgreSQL database; all 150 repository migrations applied. Module registry, module docs, platform map, architecture check, lint and typecheck passed. File symlink creation requires Windows Developer Mode or elevation, so the traversal test also checks a junction escape. This does not establish Windows Job Object supervision or actual Codex/Claude CLI behavior.

**F3e Windows draft:** C#/.NET 8 Job Object containment source written; Windows `runApprovedProfile` now fails closed without an operator-configured native host. New simulated-Windows selection/denial test source added. Native binary compilation, Windows process-tree termination and complete package tests are **not** verified in this environment.
