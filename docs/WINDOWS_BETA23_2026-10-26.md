# Windows beta 23 — signed application updates

Date: 26.10.2026. Runtime source: `45a514e82142ccbe51a8788a2307cc9efa534a16`; PR [#75](https://github.com/KeinReno/ORION/pull/75).

## Result

UI/API application packages can be built without Rust/NSIS and applied after a restart. Unchanged baseline files are signed references, copied and verified into a fresh candidate; changed bytes are transferred. Ed25519, bounded extraction, exact baseline/native/runtime/Prisma compatibility and startup trial recovery are implemented. Full installers remain required for schema/native/runtime changes and for the first transition from beta 22.

[Protocol and publishing](DESKTOP_PAYLOAD_UPDATES.md), [ADR-0033](adr/ADR-0033-runtime-payload-updates.md). The private signing key is outside Git with a user-only Windows ACL. Only its public PEM is shipped.

## Passed locally

- Unit: **1499 / 191 files**, maxWorkers=1, 191.53 sec; clean final run.
- Focused payload/service/map: 32; final selection fix: 31 payload/service tests.
- Rust: **3**. Production API and desktop export: **54 pages**.
- Chromium production parity: **43**, 1.8 min; default-full/plugins-off panels and settings navigation; no snapshot update. Isolated PostgreSQL 127.0.0.1:5444, synthetic orion_e2e.
- Native WebView2 fixture: **5 checks**: actual React hydration, module MIME, static route, trusted native IPC, native reload after switching to a rollback fixture with no React. Separate com.orion.payload-smoke profile, fake API, no database, no external web navigation or deep-link registration.
- Typecheck, architecture, module registry/docs, capability map and plugin contracts/snapshot. ESLint: **0 errors / 30 existing warnings**.
- One intermediate parallel unit run had a worker-startup timeout in docx-codec (no test executed in that worker). Its four tests and the whole suite were rerun successfully.

## Production-file package rehearsal

Signed synthetic candidate v0.1.0-windows-beta.24 (not a public release): **10232 files**, **10229 baseline references**, **660235 compressed bytes**. A changed compiled API file, new web asset and build metadata were reconstructed. The staged immutable verifier checked the signature and all file hashes. Trial rollback and subsequent commit/active selection passed. No server was started and no database was used. This is artifact/state evidence, not installed update acceptance. Actual update size depends on changed files.

## Installer evidence

[beta 23](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.23): **73961343 bytes**; SHA-256 **7839370b376bf93941dd1290a6bf2092def266f5ce7142591d258c721548d28b**.

7-Zip integrity passed. Archived/staged build metadata and payload verifier/native contract/public key match. All **143 migrations**, Node/PostgreSQL/Prisma, API and web assets are present. No personal DB, runtime configuration or signing private key was included. Packaged AppModule/Prisma import passed with NODE_ENV=test, no server/database started. Installer Authenticode: **NotSigned** (separate from Ed25519 payload authentication). The release tag targets runtime source 45a514e; later documentation commits do not alter packaged code.

## Remaining acceptance limits

- Clean NSIS install, personal-profile upgrade and a complete installed payload success/failure cycle have not been exercised. Archive/state/native-UI rehearsals are separate evidence.
- Full database integration suite was not repeated for this lifecycle-only slice; no schema/domain changes were made.
- GitHub CI has the known billing block; local results are not green remote CI.
- No Android or two-device acceptance. The module independence arc remains open at 17 exception files; it was not expanded in this task.
