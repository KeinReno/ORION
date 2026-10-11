# ADR-0006: Documents editor reports unsaved changes to the host

Status: accepted for the current UI hardening pass (2026-10-11).

## Problem

The optional `documents-office` editor already warns on browser reload, but selecting another file, folder, or Documents view unmounts it without warning. That can discard an unsaved DOCX or XLSX draft. Documents Base must not import or inspect the Office editor's internal state.

## Decision

Extend the existing typed `documents.editor` slot with `onDirtyChange(dirty: boolean)`. A contributing editor reports whether leaving it would discard edits. Documents Base owns navigation and shows one confirmation before replacing or closing a dirty editor. The callback carries only transient UI state; no editor content enters Base, and no persistence contract changes.

The entire preview pane and each file editor are keyed by document ID so a different file starts with fresh editor and filename state. This also prevents the previous file's debounced rename value from being applied to the newly selected file. The host continues to work when no editor plugin is registered: plain previews report no dirty state.

## Scope and follow-up

The guard covers direct file selection, keyboard file selection, folder navigation, active/trash switching, externally focused files, and closing a narrow preview sheet. A browser reload remains protected by each editor's `beforeunload` handler. The host's own panel/tab closure and destructive actions against an open file need a separate review against the workbench navigation contract; this callback alone cannot intercept a parent Dockview tab close.

Verify with both Office enabled and disabled. Do not change the default-full profile or stored document data.
