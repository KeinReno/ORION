# Context for controlled HH import

Read architecture docs, MODULE.md, ADR-0008 and Hub spec/progress. Source folder HH stays read-only. Use only synthetic fixtures in tests/smoke. Never import real user materials automatically or transfer credentials to ORION.

Keep normalization pure and allowlisted. A complex file is skipped entirely; malformed files produce explicit warnings. Safe HH links strip query credentials and never allow foreign domains/userinfo. Preserve immutable source hash/path. No imported verified/status string establishes a confirmed send or confirms profile facts.

All owner/plugin checks inside transaction. Profiles need their own enabled plugin if selected or attached. Apply row lock scoped by workspace after access checks; checkpoint/report/inserts commit atomically. Public import ports own neighboring tables. Never overwrite existing cards, profiles or prior material versions. Restore must leave import runs canceled. Disabled plugin retains data.

Frontend: typed slots and @orion/core API; preserve local form data on error, use @orion/ui ConfirmDialog for discard choices. No auto-apply on opening a saved run. Limits and partial-commit cancel behavior must stay visible. Next phase is assistant assessment as another optional plugin, not an implicit expansion of this adapter into execution.

Binary documents are parsed only on the client and arrive as text plus `extraction` metadata; the server must stay fail-closed (no metadata or non-ok status → warning with a code, no material). Never add server-side execution of document content. `.doc` OLE stays unsupported unless a real parser with limits is added and tested. Do not merge parts into one run silently; a part without importable records is reported from the 400 response `warnings`.
