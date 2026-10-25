# Application payload updates — protocol 1

Implementation: [ADR-0033](adr/ADR-0033-runtime-payload-updates.md).
Core lifecycle, not a module extraction or a redesign.

## User flow

Install the transition full installer once. Settings → updates continues to use
Check → Download → Install and restart. A compatible signed application package
is preferred over the installer. UI reports package versus installer and size.
Save unsaved edits first. No installation or database import happens on download.

The package includes the static web export, compiled API, production dependencies,
Prisma files and build metadata. It excludes Tauri, the launcher, Node/PostgreSQL
and all user data. The immutable launcher remains the trust boundary.

New payloads require the exact installed shell base tag, Windows x64 and the
exact Prisma schema/migration fingerprint. A schema/native/runtime change needs
a full installer. A full installer changes the base and invalidates old payload
selections. Public-key rotation also needs a full installer.

## Selection and recovery

`app-updates/versions/<id>` holds separate immutable candidate directories under
the effective node-data directory. `state.json` atomically records pending,
trial, active, previous and failed selections. Download never changes selection.
Verification runs again before queueing and at startup; extra, missing, modified
and linked files are rejected. Signature keys never come from the GitHub feed.

On restart the launcher publishes the selected web directory in the requested
desktop-data directory's `app-runtime.json`. The native shell serves it through
the existing trusted `tauri` protocol, including detached windows. Paths remain
confined to that root; HTML receives CSP hashes for its actual inline bootstrap.
No remote IPC permission or new browser origin is introduced.

A trial commits only after API `/system/health` reports database=ok and React's
root hydration acknowledges the matching build tag. Timeout (150 seconds), API
exit or startup failure restores the previous selection. An interrupted trial
rolls back on the next launch. The native shell watches selection and reloads
trusted windows on rollback even if the new JavaScript cannot hydrate. The root
readiness acknowledgement retries transient network failures for 180 seconds.
The settings show startup rollback failure.
This detects startup failures, not every possible business/UI regression.

The previous payload and user data are retained. Protocol 1 never applies a
changed schema, so switching application versions does not promise reverse SQL
migrations. Do not delete version directories manually while a trial is running.

## Publishing

Keep the Ed25519 private PEM outside Git and back it up securely. The public PEM
in `apps/desktop/runtime/update-public-key.pem` is bundled with the full installer.
`scripts/generate-update-key.mjs <private-path> <public-path>` can bootstrap a
key pair; it refuses an in-repository private path or silent public-key rotation.
The signing key is separate from an Authenticode publisher certificate.

For a full installer, set `ORION_BUILD_TAG` and run `pnpm build:desktop-installer`.
Optionally override `ORION_UPDATE_PUBLIC_KEY_FILE`. Keep the installed baseline
runtime available for the next packaging command (only its metadata, trust key
and Prisma files are read).

For an application-only release, on Windows PowerShell:

```powershell
$env:ORION_BUILD_TAG = 'v0.1.0-windows-beta.24' # next actual release
corepack pnpm build:desktop-stage
$env:ORION_UPDATE_PRIVATE_KEY_FILE = 'C:\secure\orion-update-private.pem'
corepack pnpm build:desktop-payload `
  'apps/desktop/src-tauri/resources/runtime' `
  'C:\path-to-installed-ORION\runtime' `
  'tmp/ORION_app_v0.1.0-windows-beta.23.orion.gz'
```

The asset name must be **ORION_app_<installed-shell-base-tag>.orion.gz**, whereas
the signed manifest/build tag and release tag identify the **new** version.
Do not use the previous payload tag as the shell base. Different baselines need
separately signed packages. The packer checks the signing key and database hash
against that baseline and fails closed on incompatible changes.

`build:desktop-stage` rebuilds API/web and stages dependencies; it does not run
Rust/NSIS. The staging script still copies existing Node/PG binaries for reuse by
the full installer, but the payload packer excludes them. Never run desktop export
concurrently with a production Next browser test using `.next`.

Upload the package to the new GitHub release after tests, alongside release notes.
Include a full installer whenever users on older baselines need to upgrade.
Old clients ignore package-only releases. Existing GitHub token configuration
and local-only update routes remain in place. Installer SHA-256 handling remains
backward compatible; payload authenticity comes from the signed manifest and its
per-file hashes, independent of release-body checksums.

## Validation boundary

Synthetic signed-container/service/state tests, Rust path/CSP tests, production
builds and archive verification do not prove an installed Windows update. Before
declaring native acceptance, exercise a clean transition install, a successful
signed update, a deliberately broken candidate with automatic recovery, an
interruption/relaunch, multiple/detached windows and preservation of real login
state on an isolated disposable profile. Never use a personal database for this
rehearsal.
