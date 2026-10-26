# Phone-linked profile recovery and cleanup — 26.10.2026

Historical operational report; follows `SYNC_WINDOWS_BETA25.md`. The owner
authorized removing all other workspaces, keeping the one linked to OPPO.
No application source code or migration definitions were edited in this pass;
the normal launcher's migration checks were retained during the update.

## Identity and cleanup

Compared the saved phone replica's node ID, certificate fingerprint, user ID and
workspace ID with the real installation. Ordinary LocalAppData reads from the
Codex MSIX process resolved to an old virtualized profile. Reading the same
physical location through the local administrative share exposed the real
host-mode profile, whose node ID exactly matched the phone.

The real database already contained just one workspace: `Kaiden`, owned by the
phone's existing account. It was not deleted, recreated, renamed or imported.
The unrelated green `KAIDEN` belonged to the stale virtualized profile, rather
than a second workspace in this database.

Stopped that stale runtime, shut down its PostgreSQL gracefully, closed its shell,
verified the two profile paths and different node identities, then moved the
obsolete MSIX LocalCache profile out of the active lookup path into a private
archive. This removes it from normal app selection while retaining recovery;
it is not a permanent SQL deletion of its workspace. Development/test databases
and other checkouts were not cleaned as part of the user's app profile.

A separate cold backup of the correctly identified real profile was taken
before recovery, including PostgreSQL, files, configuration and device trust.
Configuration/trust/control-file hashes were checked against that backup.
Earlier backup of the ambiguous profile is not substituted for this one.

## Windows update

Installed the complete beta.25 file set from the previously verified package:
retained the old runtime/binary, copied a fresh full runtime and native EXE into
the real installation, then started its launcher with an explicit canonical
profile path. This was a manual complete-file update, not an NSIS installation
acceptance. The old shell stayed resident after closing its window, so only
the verified old ORION shell process was stopped before replacing the EXE.

Runtime has11908 files. Installed EXE, build metadata, launcher, shell contract
and compiled hybrid-sync service hashes matched the prepared beta.25 artifacts.
Runtime is running from the installed directory, not the temporary build stage.
Health and database are `ok`; update status reports `v0.1.0-windows-beta.25`;
LAN HTTPS4443 and loopback API4000/PG55432 are listening. Device trust and TLS
keys were retained. The native workspace picker was inspected: one `Kaiden`
workspace, original account already signed in.

## Physical OPPO acceptance

The user opened Orion manually after automatic tool review rejected an ADB app
opening command. Existing pinned native LAN transport then returned200 for the
workspace list, with exactly the protected `Kaiden` and owner role. No re-pairing,
credential reset or phone-local import was performed.

`QA OFFLINE beta25`, created while LAN was unavailable and preserved through
WebView reload, arrived on the restored host exactly once. Phone replica had
zero pending operations and zero conflicts after reconnection.

Removed only synthetic QA records created by this acceptance work: the two QA
notes and the QA list/item. Notes use the normal synced trash operation; the
list was archived before deletion, as required by the existing host contract.
The earlier rejected active-list deletion warning was acknowledged after the
correct operation. Final phone SQLite state: pending0, conflicts0, remote task1,
remote notes0, remote lists0. Original phone-local tasks7 and notes1 remain.
The original host task was retained. Phone was returned to Tasks.

## Remaining limits and follow-up

This closes the profile mismatch and actual unavailable-LAN/outbox acceptance.
It does not establish VPN or two-physical-PC acceptance. The installed desktop
window was repeatedly minimized/concurrent input was detected, so a new physical
PC-checkbox-to-phone test after beta.25 was not completed. The causal clock fix
has15 passing PostgreSQL/HTTP integration tests; earlier physical note rename
PC-to-phone evidence remains recorded separately.

Two Android UX issues were observed and are not fixed by this profile cleanup:
the UI offers active remote-list deletion although the host requires archiving
first; the fresh-connection label compares server wall time with phone time and
can show a stale response when the phone clock is ahead. Neither should be
reported as missing data delivery when the outbox is confirmed empty.
Android remains alpha.23; no APK or Android code changed in this pass.

For future Codex runs, verify node/workspace identity before modifying profiles.
Do not assume the same apparent LocalAppData path resolves to the same files in
packaged and unpackaged processes; do not merge PostgreSQL directories or copy
credentials between identities. Keep operational backup paths private.
