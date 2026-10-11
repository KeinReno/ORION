# ADR-0005 — Saved task views restore every stored filter

Status: accepted for the UI parity fix, 11 October 2026.

The `tasks.views.bar` extension contract exposed only search and project. The persisted `TaskViewFilters` contract already permits due date, status and priority. Existing saved views named “Просрочено” and “На этой неделе” therefore appeared active but could show unrelated tasks. This is a behavioral defect in the existing feature, not a new plugin or a change of ownership.

The Tasks Base Module continues to own filtering. Its slot props now expose the full normalized set of filters to the `tasks-saved-views` plugin, which saves and reapplies them through that typed slot. No plugin imports the module's internal code; the persisted schema and existing views remain valid. Missing fields in older saved views normalize to “all” or an empty selection.

Acceptance: clicking a saved due/status/priority view changes the visible task set; only the last applied matching view is highlighted; changing a filter removes the highlight; resetting filters restores all tasks. The Base Module works with the plugin disabled.
