# LAN sync and Windows beta.25 — 26.10.2026

Historical acceptance report. Runtime source: `f8022db`; Android remains
alpha.23 (`0.1.22`, code23). This report does not establish completed pairing
or synchronization of every installation.

## Changes

- Merged current master into the Android branch, retaining platform boundaries.
- Network settings now link owners directly to the workspace exchange mode,
  explaining pairing versus hybrid data exchange and separate phone-local data.
- Fixed causal HLC propagation. A phone approximately78 seconds ahead of the PC
  exposed a lost list-item edit: the PC had read the item but its next timestamp
  was older than the accepted phone stamp. Snapshot/pull now return the maximum
  of physical host time and persisted field stamps for included modules of the
  authorized workspace. Existing clients already receive this watermark.
- The query remains inside the existing RLS transaction; no schema, permission,
  protocol-version, clock-skew policy or ownership changes were introduced.
- Removed Prisma's generated download cache from installer staging. Runtime
  client binaries remain present.

## Evidence

- Baseline after merge: typecheck PASS;1577 unit tests PASS; lint0 errors,
  30 existing warnings; architecture/plugin/platform-map/module-doc checks PASS.
- A new real PostgreSQL/HTTP regression failed before the HLC fix (`superseded`).
  After the fix,15 hybrid integration tests PASS in separate `orion_sync_beta25`:
  two clocks, pull, fresh snapshot, subsequent edits and foreign-workspace clock
  isolation, alongside existing access/retry/conflict/convergence checks.
- API typecheck and focused lint PASS (3 existing unused-variable warnings).
- Physical OPPO: note created on phone reached the installed PC; title edited on
  PC reached phone automatically. A synthetic list/item reached the PC; its
  checkbox edit exposed the HLC bug before the new Windows runtime was installed.
- With LAN actually unavailable, synthetic `QA OFFLINE beta25` was saved on OPPO
  and survived WebView reload. Delivery after reconnection is NOT yet accepted.

## Installer

Full API/static-web/runtime/Rust compilation completed. NSIS failed on paths
longer than Windows permits in the long checkout, including dependency source
maps after cache removal. For this artifact, copied the prepared resources to
`B:/Temp/orion-beta25-resources`, replaced only their source prefix in generated
`installer.nsi`, and ran the same bundled makensis. Runtime contents and target
installation paths were preserved; do not treat the unmodified long-path build
command as green. Prefer a short checkout for future full builds.

Installer: `ORION_0.1.0_x64-setup.exe`,76049784 bytes.
SHA-256: `bc689eecac74d620bf472c88206be2988bda15b5a6f763882684afbc65599cc6`.
Authenticode: `NotSigned`.7-Zip archive test PASS (11915 files).
Packaged runtime started on a fresh private profile, API4144/PG55452:
health=`ok`, database=`ok`, update tag=`v0.1.0-windows-beta.25`.

## Outstanding installation/profile issue

Before updating, stopped the installed runtime and PostgreSQL (graceful INT)
and saved a cold private database/config/trust copy outside the repository.
After restarting the existing beta.23, Windows opened a green `KAIDEN` workspace
and a local-mode node whose identity differs from the phone's remembered host
and previous `Kaiden` workspace. The original connection has NOT been restored.
Do not pair over it, import the phone copy, overwrite a profile or claim the
old profile was migrated. Locate/confirm the intended desktop profile first.
The new installer has NOT been installed over this ambiguous user profile.

The phone retains its existing local data, remembered selection and queued test
note. Synthetic QA note/list/offline records still require scoped cleanup after
the correct host is restored. No real user record was intentionally deleted.
Private database copies and screenshots must not be attached to releases.

Next acceptance: restore the exact remembered host; install beta.25 over the
confirmed profile; observe list checkbox convergence without HLC warnings,
automatic desktop refresh, offline outbox drain with exactly one copy and
synthetic-only cleanup. VPN, two physical PCs and finance sync remain unverified;
Android finances remain local.
