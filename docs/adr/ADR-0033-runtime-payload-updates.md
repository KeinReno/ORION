# ADR-0033: Signed desktop application payloads

Status: accepted for implementation (owner requested 25.10.2026).

Core owns application lifecycle. Ship UI + API + production dependencies together,
separately from the immutable Tauri shell, launcher, Node and PostgreSQL.
The shell retains the trusted tauri origin and IPC boundaries for all windows.

Protocol 1 uses a streaming gzip container: magic, bounded signed manifest, then
the manifest's files in order. Ed25519 authenticates the exact manifest bytes;
each file has a length and SHA-256. Reject links, ambiguous Windows paths,
duplicates, trailing data and oversized containers. Trust keys come only from the
installed runtime, never the feed or downloaded payload.

Unchanged baseline files are signed references (`source: "base"`), copied and
hashed into a fresh candidate without transfer or hard links. Changed files are
embedded in order. All target files remain covered by the signed manifest.

Payloads require an exact shell base tag and exact Prisma schema/migration hash.
The native/config/binary/helper fingerprint must also match, so a native change
cannot accidentally be published as an application-only package.
Schema changes require the full installer in this version; no implicit migration
rollback. Node/PostgreSQL/launcher/native changes also require an installer.

Download and verify into a new directory. Applying records a pending selection,
then closes the local app and restarts it. The launcher tries that selection,
checks API health and an explicit UI-ready handshake before committing it. A
crash or failed readiness restores the previous selection; user DB/files are not
replaced. An interrupted trial is rolled back at the next start.

Installer-only releases remain supported. Lightweight-only releases may coexist;
old clients ignore them. Public-key rotation requires a full installer. Real
signing keys are never committed. Windows native install/update acceptance is a
separate gate from synthetic tests.
