# Alpha.20 — foreground data exchange and truthful scope status

24.10.2026; Android0.1.19/code20. Trigger: user reports successful discovery/pairing,
but sees no data exchange. Verified code causes: mobile sync was manual-only;
phone-local records are intentionally separate; ordinary desktop Notes query did not
poll, Tasks polled once/minute. These are code findings, not a trace of the user's
physical session. Backend protocol and role boundaries are unchanged.

## Implementation
After authenticated workspace selection, one scoped driver exchanges immediately,
after queued edits (650ms debounce), every15seconds in foreground, and on focus,
visibility/resume/online. No WorkManager/background-service guarantee. Hidden/native
inactive state pauses new requests. Stop clears timers/subscription; in-flight work
stays bound to its original replica. Running/manual operations don't overlap; current
MobileRemoteClient serial queue and network guard remain authoritative. Revoked
engine is not retried automatically. No trust/account/workspace is selected implicitly.

Tasks/Notes/Lists of the selected PC workspace exchange; phone-local records and
finance do not join it. Existing explicit tasks/notes copy requires backup and named
workspace consent; it remains idempotent. Lists and finance are not copied by that
legacy action. Never silently import personal records into a shared workspace.
New status banner identifies paired-but-not-logged-in, no workspace selected, local
scope, finance unsupported, exchanging/offline/revoked/pending/conflicts/confirmed.
A loaded stale copy is not described as newly downloaded. Manual sync remains.

Desktop ordinary queries: Tasks15s (was60s), Notes15s (was none), hidden-tab polling
disabled. Existing hybrid replica driver already uses15s; Lists already poll15s.
Only active/enabled queries run; editor-local input and CAS are retained. Corrected
outdated desktop hybrid hint that called Tasks/Notes read-only. Desktop source changes
are in the feature branch; no new Windows installer is claimed by this APK release.

## Evidence
New scheduler tests use two real ReplicaEngines/MobileRemoteClients and synthetic
MemoryHost: phone note→PC, PC task→phone, hidden/resume, offline pending preservation
and retry without duplicates, no overlapping requests, cleanup. Browser discovery
smoke additionally asserts that paired/no-login UI asks for login rather than claiming
synchronization. Native phone/Windows/VPN/router acceptance remains NOT RUN.
Final local checks and release hash are recorded in outputs/android-alpha20/REPORT.md.

## User acceptance path
1. Desktop: correct workspace → Sync → Workspace mode/devices → Hybrid (owner only).
2. Phone: Connection → log in to the PC account → select SAME workspace.
3. Create a task there on phone; with both apps active allow15s, check PC same workspace.
4. Create/edit on PC; allow15s, check phone PC workspace.
5. If old phone-local records are needed, export current backup, acknowledge target
   workspace and use Copy phone records. This keeps originals; finance is excluded.
6. Turn off network: pending count/offline must appear; resume network and verify
   queue drains once. Pairing/discovery alone must never claim data confirmation.

Files: Android foreground-sync.ts/test, sync-status.tsx, use-lan.ts, connection.tsx,
app/App.tsx, versions and smoke fixtures; core-react use-tasks/use-notes polling;
desktop hybrid-mode-section copy; this report/README/STATUS.


## Local validation
116 focused tests PASS (including3 new automatic exchange/queue/recovery/cleanup tests),
15 browser scripts PASS, 11 plugin-contract tests, workspace typecheck, lint0 errors
(29 existing warnings), architecture/module-docs PASS. Final changed-file lint clean.
assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS (10 existing JVM).
Exit/forget stops and drains in-flight automatic exchange before clearing replicas;
a failed disconnect recreates the driver on retained client. No new native permissions.
Vite bundle-size warning/native baseline warnings remain. Published APK is debug
signed with the previous test certificate; unsigned release variant is not distributed.
