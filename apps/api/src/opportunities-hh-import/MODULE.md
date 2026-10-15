# Opportunities HH File Import — R0.2

Optional plugin `opportunities-hh-import`, default-off. Owner-only REST `/workspaces/:workspaceId/opportunity-hh-import`: POST preview, GET recent (20), GET :id, POST :id/apply/cancel, GET sources/:opportunityId (up to 50 captures/history each).

Accepts selected relative-path text uploads: supported resume MD/TXT, allowlisted vacancy/history JSON. Scripts, browser profiles and session files excluded in browser and parser. Unknown categories and PDF/DOC/RTF unsupported. Max 250 files / serialized input 500,000 characters, browser max 1 MB bytes; individual resume max 50,000 characters. Does not read/run scripts or change the original HH directory.

Preview persists sanitized immutable plan, SHA-256 manifest, report, checkpoint, revision, expiry 24h. Apply consumes stored upload snapshot, not a live filesystem; new file content needs new preview. Each request commits up to 25 operations; scoped row lock + expectedRevision protects same-run races. Insert-only public Base/profile ports preserve existing cards/manual edits. Unique keys deduplicate cards/captures/materials/history across runs. History hashes include explicit target profile; no inference of candidate/account from logs.

Provenance: relative sourcePath, original vacancy file SHA-256, normalized record SHA-256, capture date and historical flag. Snapshot stores normalized conditions as well as text. Legacy outcomes: already_exists / legacy_claimed_verified / failed / unconfirmed, never confirmed. Possible overlap is flagged, not silently promoted/merged. Import doesn't create factual statements or send anything externally.

FORCE RLS, composite workspace foreign keys on captures/history. Public dependencies only: opportunities/public.ts and opportunities-profiles/public.ts; composition registered in OpportunityExtensionsModule. UI slots opportunities.views and opportunities.details.sections. Snapshot includes all three models after their parents; restored import runs are canceled with revision increment, preventing automatic resume from an old backup.

Tests: hh-parser.test.ts, opportunity-extensions.integration.test.ts, existing Base/RLS/snapshot suites. Cancel retains already committed portions; runtime resume requires explicit user action. No filesystem watcher, OCR, live HH refresh, HH auth/session, cover generation or browser executor.
