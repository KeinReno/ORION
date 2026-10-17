# Opportunities Assistant — R0.3

Optional plugin `opportunities-assistant`, default-off, extends `opportunities` and needs `opportunities-profiles` for evidence. Owns **immutable assessments** and **editable response drafts** for one opportunity × one profile. Disabling keeps all data; API and UI become unavailable.

**Nothing leaves ORION.** The only provider is `rules-v1` (local deterministic rules). The `llm` provider is declared in `GET status` as unavailable (`sendsDataExternally: true`) and `POST assessments {provider:"llm"}` is refused with 409 and creates nothing. Connecting a real model needs an owner decision on provider, budget and which profile fields may be sent — see the progress document. There is no send capability anywhere in this module: dry run is `send: false` by construction.

## API (`/workspaces/:workspaceId/opportunity-assistant`)
| Route | Who | Behaviour |
| --- | --- | --- |
| `GET status` | member | providers and `externalSend: false` |
| `POST assessments {opportunityId, profileId, provider}` | member | creates an assessment, or returns the existing one for identical inputs (idempotent) |
| `GET assessments?opportunityId&profileId&cursor` | member | newest first, 20 per page, `stale` computed on read |
| `GET assessments/:id` | member | one assessment |
| `POST drafts {opportunityId, profileId, kind, question?}` | member | `response` / `proposal` / `answer` (question required for `answer` only) |
| `GET drafts`, `GET drafts/:id` | member | `approvalValid`, `blockers`, `stale` computed on read |
| `PATCH drafts/:id {expectedRevision, sections[]}` | member | CAS; any edit drops the approval |
| `POST drafts/:id/approve {expectedRevision, textHash, acknowledgeManualSections}` | **owner** | approves the exact text the owner saw |
| `POST drafts/:id/reject {expectedRevision}` | **owner** | |
| `POST drafts/:id/dry-run` | member | exact payload + `payloadHash` + blockers; persists nothing |

## Rules of the assessment (rules-v1)
- Requirements are extracted from the description by headings and lists (`Требования`, `Будет плюсом`, …). No headings → bullet lines are treated as must-have and the assessment says so; no list → no requirements, stated as unknown.
- A match counts only against **confirmed, non-archived** facts (lexical overlap ≥ 0.6 → `matched`, ≥ 0.34 → `partial`). Unverified facts and mentions in the active resume text give `unknown` (evidence shown as unverified); disputed facts give `conflict`; nothing gives `gap`. Numeric constraints ("от 3 лет") are never auto-confirmed.
- Conditions check profile preferences: excluded company/role, work format, minimum net salary (no currency conversion; non-monthly or gross amounts → `review`, never `ok`), city, track. Hard mismatches go to `autoSendBlockers` regardless of score.
- Score 0–100: must 50%, conditions 20%, track 15%, nice 15%; categories without data are left out and unknown never earns points. `confidence` is the reliability of the inputs, not a hiring probability.
- Vacancy text is **data**: instructions inside it change nothing (covered by tests).

## Staleness
Each assessment/draft stores hashes of its inputs (`opportunity` content, profile `preferences`, `facts` id/revision/state, `tracks`, `resume`). Reads compare them with the current state and report which part changed. Status/archive changes of the card do not stale anything. A stale draft cannot be approved, and a stale approval is not valid. Staleness is computed, never stored; the old record stays as history.

## Drafts
Template `template-v1`: greeting/intro/closing/signature (no claims) + one section per matched requirement built from the confirmed fact text. Gaps go to `notes` and are **not** in the text. An empty section stays empty with a hint. Each section has a `basis` computed on read: `template`, `confirmed`, `unverified` (a fact lost its confirmation), `manual` (edited by a person), `empty`. Approval requires: fresh data, no unverified/empty sections, non-empty text, the `textHash` the owner saw, and an explicit acknowledgement for manual sections. **Approval is not permission to send.**

Dry run lists blockers: not approved/invalid approval, stale, unverified or empty sections, unmet must-have requirements and hard exclusions from the linked assessment, no resume version selected.

## Data
`OpportunityAssessment` (immutable), `OpportunityDraft`; FORCE RLS, composite workspace foreign keys (cascade with the opportunity/profile). Draft column `inputHash` holds the JSON of input component hashes. Snapshot: both included; on restore **draft approvals are reset to `draft`** (revision bumped) so nothing comes back approved from a backup.

Ports used (read-only): `OPPORTUNITIES_READ_PORT.v1` (Base), `PROFILE_EVIDENCE_PORT.v1` (profiles). The plugin never touches neighbouring tables directly. UI: typed slot `opportunities.details.sections` (`apps/web/plugins/opportunities-assistant`).

Tests: `assistant-engine.test.ts` (unit), `apps/api/test/opportunity-assistant.integration.test.ts` (PostgreSQL/RLS), `e2e/opportunity-assistant.spec.ts` (browser).
