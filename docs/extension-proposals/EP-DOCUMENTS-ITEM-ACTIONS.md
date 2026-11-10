# Extension Proposal: `documents.item.actions` and AI document summarization

**Status:** proposed; scaffold plugin `documents-ai-summary` prepared, host wiring
awaits approval of this slot.

## Context

Documents exposes `documents.editor`, `documents.history` and `documents.create`
slots, but none lets a plugin add an action to the selected document's toolbar or
context menu. AI summarization (PLATFORM.md §3, example plugin; §8 Этап 7 test
extension) needs exactly that: an action on an existing document that reads its
content and produces a summary.

Documents must not import the assistant, AI Bridge credentials or any AI module
internals. The assistant (ADR-0017, owner-key variant C) already exists
server-side; `documents/public/document-content-reader` already exposes document
content to other components through a public contract.

## Proposed extension point

Add the typed `documents.item.actions` slot, mirroring the approved
`tasks.context.actions` pattern:

- The Documents host gives a contribution the workspace, the selected
  `DocumentItem`, and controlled open/close state.
- The contribution declares one menu label and action id in slot metadata.
- The host inserts the entry into the document toolbar/menu and mounts the
  contribution's dialog only when selected.
- With no enabled contributions the toolbar renders exactly as before.

The host owns document identity and menu composition. A contribution owns its
dialog and its own data access through public contracts only.

## AI summarization contribution

The optional `documents-ai-summary` plugin contributes «Суммаризировать ИИ…»:

1. Reads the document text through the public `DocumentContentReader` server
   contract (no direct storage access).
2. Sends the text to the owner-key assistant endpoint (ADR-0017) with a fixed
   summarization instruction; never asks for or stores API keys itself.
3. Shows the summary in its dialog and offers «Сохранить как заметку» — creating
   the note through the public Notes API, linked back to the source document.

Failure modes are explicit: missing owner key → dialog explains where to add it;
unsupported/binary content → the action is disabled with a reason; assistant
error → shown verbatim, no fabricated summary.

## Disable behavior and ownership

Disabling the plugin removes the action; nothing in Documents changes and no
data is deleted. Documents owns documents. The plugin owns nothing persistent
except optionally created notes (owned by Notes).

## Acceptance

- The action appears on text-bearing documents, is hidden/disabled with a reason
  on binary or empty ones.
- Summary text round-trips through the assistant endpoint; saving creates a
  linked note via the public Notes API.
- Plugin disabled → no UI trace, no data change.
- `architecture-check`, `platform-map:check`, plugin contract tests pass; the
  plugin contract version is bumped and the snapshot regenerated (same procedure
  as `tasks.context.actions` in plugin contract 1.5.0).

## Implementation order

1. Approve this proposal.
2. Add the slot to `apps/web/lib/extensions/contracts.ts` (interface +
   `CORE_SLOT_NAMES` + meta), bump plugin contract, regenerate snapshot and map.
3. Host wiring in `DocumentsPanel` (toolbar entry + controlled dialog mount).
4. Move the `documents-ai-summary` scaffold from
   `docs/extension-proposals/documents-ai-summary-scaffold/plugin/` into
   `apps/web/plugins-ext/` and restore its `web.contributions` entry (kept out
   of the scanned tree so module-registry stays valid until the slot exists).
5. Unit + browser smoke on default-full and plugins-off profiles.
