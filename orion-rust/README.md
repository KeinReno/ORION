# ORION-Rust runtime

The direct supervisor provisions PostgreSQL and applies migrations from the
installed base before opening a payload trial. Signed payloads must match the
installed base database hash. Database changes ship through the full installer.

## Windows lifecycle harness

From the repository root, prepare the bundled runtime and run the standalone
test against a disposable PostgreSQL profile.

```powershell
rustc --edition 2021 --test orion-rust/experimental/postgres_lifecycle_harness.rs -o orion-rust/target/pg-lifecycle-harness.exe
$env:ORION_RUN_POSTGRES_LIFECYCLE_HARNESS = 'I_ACCEPT_DISPOSABLE_LOCAL_POSTGRES'
& orion-rust/target/pg-lifecycle-harness.exe windows_harness::bundled_postgres_lifecycle_is_contained_and_stops_gracefully --exact --nocapture
```

## Windows process and path checks

The supervisor creates the child suspended, assigns it to a Job Object with
kill-on-close, and resumes it after assignment. The initial thread handle is
owned by the spawn cleanup path. `TerminateThread` is a last-resort cleanup
operation for the initial thread of a child that has never been resumed.

Path and ACL checks precede later filesystem operations by pathname. Their
integrity depends on the checked directories and ancestors remaining under
trusted control for the duration of the operation.


## Local diagnostics

`orion-runtime serve` exposes `/health` on loopback. To enable `/v1/profile`
and `/v1/diagnostics`, set `ORION_RUNTIME_DIAGNOSTICS_TOKEN` to an independent
random token of at least 32 base64url characters before starting the process.
Clients send it in the `Authorization: Bearer <token>` header.

## Signed payload rollback rehearsal

On 2026-11-24, a Windows debug build of `supervise-direct` ran against a
disposable PostgreSQL profile and a copy of the bundled runtime. A test
Ed25519 key signed a payload of 11,363 files and 231,308,030 bytes. The base
and candidate used the same database fingerprint. The candidate API exited
with code 42 after emitting a unique test marker. The base API then returned
`database=ok`, the candidate moved to `failed`, and the supervisor wrote
its graceful shutdown marker.

The startup `payload-select` stage took 13 ms on the base launch and
11,205 ms on the signed trial launch. The separate JavaScript queue operation
took 11,368 ms. These are single-run measurements on a debug Windows build
with freshly copied files. The rehearsal exercised the Rust supervisor and
bundled Node/PostgreSQL directly. Installed Tauri startup and WebView ACK
remain separate acceptance checks.
