# ADR-0040 — Habitat observe-only supervisor (PROPOSED)

**Date:** 2026-10-29
**Branch:** `feature/habitat-f3-supervisor-20261029` stacked on Habitat F3, Agent Hub F2/F1/F0.
**Status:** local prototype with unit tests; not accepted as a Windows service or as server-registered runtime.

## Decision

Create a local opt-in `supervise` CLI in the Habitat package that periodically **reads** Agent Hub's existing scoped queue without claiming tasks or launching processes. This provides safe lifecycle groundwork for a future runtime manager while avoiding a dangerous interpretation of a valid token as proof of an online agent.

- `config.enabled` and `config.supervisor.enabled` plus an explicit operator CLI flag required. Poll interval 10–300 seconds.
- Only loopback HTTP; bearer token lives in a separate local file, never reaches a child process or persisted state.
- State is stored via unique temporary file plus rename inside the canonically checked workspace. One `wx` lock prevents two local monitors.
- Each session receives a fresh random UUID; previous unclean status is recorded as `previousSession.interrupted` but **never** auto-requeues or reruns work.
- Unauthorized 401/403 stops further polling. Transient network failures set `offline`, with no fake online assertion.
- SIGINT/SIGTERM request graceful shutdown. Lock cleanup occurs in a finally block; a forcibly killed process leaves a stale lock that requires operator inspection.
- `supervisor-status` reports only local observation freshness, not a remote runtime-attestation claim.
- The queue view remains governed by Agent Hub token mode, module permission, tasks:read and existing project fences.

## Deferred before autonomous execution

Server-runtime registry, authenticator-proof session binding, Windows process tree supervision, lower-privilege OS identity, provider capability/license verification, secure checkpoint restore and independent artifact verification.

A successful local `GET` proves only that this token could read queue data at one instant. It is **not evidence** that a particular CLI is running. This PR does not register runtimes in ORION or change Agent Hub state.

## Validation

Standalone Node.js v22 on Linux: 8 tests pass (mocked F2 HTTP and lightweight stubs for the existing F3 module imports). Full ORION lint/typecheck, database migrations, Windows service smoke and integrated tests are not run.
