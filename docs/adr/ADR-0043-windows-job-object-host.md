# ADR-0043 — Windows Job Object host for local approved CLIs (PROPOSED)

**Date:** 2026-10-29  
**Branch:** `feature/habitat-f3e-windows-job-host-20261029`; stacked on draft F0–F3d.
**State:** C# source + Node bridge + simulated Windows test source; Windows binary not compiled or tested here.

## Decision

Do not treat Node.js `child.kill()` as a reliable way to kill CLI descendants on Windows. Use a separate, operator-supplied .NET 8 Windows executable as the boundary for **approved local CLI processes**. Windows Job Objects can manage a process group and support `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (Microsoft Win32 docs). The host:

1. Receives a bounded control argument containing an **operator-approved, fixed executable, cwd and static argv**; no task text, API keys or bearer token in this argument.
2. Creates the job and sets kill-on-last-handle-close.
3. Calls `CreateProcessW` with `CREATE_SUSPENDED` and inherited pipe/stdio handles.
4. Assigns the suspended target to the job; if assignment fails it terminates the suspended process, without resuming.
5. Resumes and forwards bounded task input via stdin; the caller hashes stdout and stderr without persisting raw model output.
6. On timeout/abort the Node caller kills the host. Closing the last Job Object handle terminates all associated processes, including descendants that remain in the job.

The existing `runApprovedProfile` behavior is unchanged on POSIX. On Windows, an operator-approved `profile.windowsHost` is **mandatory** and must resolve to an existing file. Missing host fails closed; no direct Node spawn fallback exists.

## Security and maturity caveats

A Job Object is NOT a filesystem/network/credential sandbox. The approved CLI and its children inherit the local OS identity's permissions, and provider-specific subprocesses can behave differently when nested in jobs. A production unattended worker requires a low-privilege identity, isolated worktree, OS/network policy, signed/pinned native executable, device-bound runtime attestation and independent artifact review. No auto-execution or service installer is added here.

**Required before merge:** Windows .NET build; a smoke test proving shutdown of a child **and grandchild** on host termination and on timeout; token nonleak, error-path cleanup, quote/Unicode argv, startup refusal, and actual Windows Host integration with F2–F3d. The contained executable does not automatically become an `AgentHubExecution` in `done`; it still can only submit for human review. Staged pull request remains draft.
