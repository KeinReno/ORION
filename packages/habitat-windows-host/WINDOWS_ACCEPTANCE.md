# Windows host acceptance checklist — required before merge

This is a **manual verification plan**, not a claim that the tests have been run.

0. Run `node packages/habitat-windows-host/windows-smoke.mjs <absolute-exe-path>` after publishing and record its output; the smoke is not yet executed.
1. Build/publish with the .NET 8 SDK on Windows 10/11 x64; verify no C# compiler errors and no P/Invoke marshalling errors.
2. Record SHA-256 for the produced exe; review the source before approving the path.
3. Test negative mode: omit `windowsHost` from a locally approved profile; `run` must fail with `windows_job_host_required` and no target CLI process.
4. Test valid static profile targeting a harmless local test executable that reads stdin, writes stdout+stderr and exits 0; confirm hashes, exit code and `runtime: windows-job-object`.
5. Test explicit task input with spaces, quotes and Unicode in cwd/executable/argv; confirm proper Windows command-line quoting.
6. Test child program spawning a grandchild: stop/timeout/kill the native host while it runs; **both must terminate**. Repeat after forced host crash. No orphan processes.
7. Test `AssignProcessToJobObject` failure (nested-job restrictions or synthetic failure): suspended target must never be resumed or left alive.
8. Test a long-running child that never reads stdin: timeout must kill the host and whole job without leaking child processes or local bearer tokens.
9. Test denial of unapproved executable, invalid config paths, disabled Habitat and missing local acknowledgment; nothing should be spawned.
10. Run all Node tests (`node --test packages/habitat/test/*.test.mjs`), the staged F0-F3d Nest/Prisma integration tests, and manual `run-hub` with a local test profile. Verify `review` does not imply Task completion.
11. Verify the host runs under the intended least-privilege Windows user with worktree and network policy restrictions.
12. Keep draft PR, default-off config, no auto-start until the above checks pass.

Report failures in PR #91 without claiming Windows safety from Linux-only tests.
