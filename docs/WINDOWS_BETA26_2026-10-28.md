# Windows beta 26 — bugfixes, release provenance, AI diagnostics

Date: 28.10.2026. Runtime source: `44a5dbe5060b0ad13fd13b4c2cb484a411a10c13`.

## Result

First pass through `docs/tasks/2026-10-27-orion-ux/` (20-item owner-approved backlog):
diagnostics and fixes for the P0/P1 release-provenance and regression items
(ORION-12, 13, 14, 15, 17, 18, 20). The large interactive redesigns
(ORION-01–11, 16, 19) are explicitly **not** attempted in this pass — the
backlog's own `README.md` calls for discovery/decomposition before code, not
immediate rewrites, and several carry an explicit risk note against partial
UI-only fixes.

## Changes

- **ORION-18 (avatar regression).** The desktop build's CSP (`img-src 'self'
  data: blob:`) silently blocked the avatar `<img>`'s cross-origin request to
  the API, which showed a broken-image icon. Fixed by fetching the avatar as
  a blob (same pattern as document previews) instead of a direct `<img
  src>`.
- **ORION-20 (feedback report).** `describeAuthError`/`describeError`
  collapsed every 5xx into "server is down", burying `FeedbackService`'s own
  503 ("не настроена на сервере — нет `ORION_GITHUB_FEEDBACK_TOKEN`") under a
  false diagnosis. Only a bare 500 keeps the generic line now. The token
  itself is still unset on this node — sending feedback to GitHub will not
  work until an operator configures `ORION_GITHUB_FEEDBACK_TOKEN`; that is a
  secret/configuration gap, not a code defect.
- **ORION-15 (constellation drop).** Releasing a dragged project outside a
  goal star's drop radius did nothing observable. Added an explicit toast
  explaining the miss (AC2). The underlying DnD wiring (editLinks-gated
  `onDropProject`) was already correct on HEAD and matches the installed
  beta.25 — no regression found there.
- **ORION-14 (release provenance).** Confirmed the user's report: two
  constellation fixes from 26-27.10 (`4bf5125`, `35fee65`, `fd31aec`) were on
  `master` but never shipped — `v0.1.0-windows-beta.25` predates them. Added
  `buildTag`/`commit`/`builtAt` to `AppInfo` (Settings → О программе),
  sourced from the staged runtime's `build.json` via two new launcher env
  vars (`ORION_BUILD_COMMIT`, `ORION_BUILD_TIME`) — an installed build's
  provenance is now checkable from inside the running app.
- **ORION-12 (AI Bridge).** `aiBridgeDisabledReason()` distinguishes "Хост
  LAN is on" from a genuine server deployment instead of a dead-end env-var
  hint; no new toggle was added (risk note explicit about that).
- **ORION-13 (agent permissions).** The permission matrix's "·" placeholder
  for operations the agent API doesn't support (projects beyond read,
  finance beyond create) now carries a tooltip explaining why — the
  underlying capability limits were not changed.
- **ORION-17 (sidebar order).** Swapped render order so "Открепить" sits
  above "Выйти".
- Unrelated: picked up and finished an already-in-flight, uncommitted
  feature (`soundLevel` interface sounds) that was blocking `pnpm quality`
  (missing Prisma client regen / module-registry manifest) — committed
  separately, not represented in the backlog above.
- Found and fixed one unrelated test date-rot bug:
  `health.integration.test.ts` pinned `/health/today` to a hardcoded
  `2026-10-15`, which fell outside the endpoint's `[today-7d, today+15d)`
  window once the real calendar passed that date.

## Passed locally

- Typecheck (`shared-types`, `core`, `core-react`, `api`, `web`): clean.
- Lint: 0 errors, 30 pre-existing warnings (unrelated files).
- Unit: **1506 / 192 files**, all green.
- Integration (isolated `orion_scratch` DB, migrated + granted fresh):
  **634 / 635** green on the full run; the one failure
  (`domain-events.integration.test.ts` outbox retry/backoff) passed cleanly
  when re-run in isolation — a parallel-run race in the test, not a product
  defect, and not something introduced in this pass.
- `pnpm build` (api + web) and `build-desktop-installer.mjs` (API, static
  web export, Tauri release compile, NSIS): all green. Staged runtime's
  `build.json` reads `{"tag":"v0.1.0-windows-beta.26","commit":"44a5dbe",…}`;
  no `.env` bundled.

## Installer evidence

[beta 26](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.26):
**74193514 bytes**; SHA-256
**2ddf3cc7c57d490958becc5f25da686bfa9b89457ad95467345b99cac53111db**.

## Remaining acceptance limits

- No clean-install / upgrade-from-beta.25 rehearsal was run (no Tauri window
  was opened; this agent session has no interactive desktop to click
  through).
- GitHub CI remains billing-blocked; this is local evidence only.
- `ORION_GITHUB_FEEDBACK_TOKEN` is still unconfigured — feedback reports
  will fail with a now-accurate error until an operator sets it.
- ORION-01–11, 16, 19 (the interactive-redesign items) are untouched —
  deliberately, per the backlog's own sequencing and risk notes.
