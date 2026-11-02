# ADR-0045 — reviewed ORION DEV import

Status: Accepted for the owner-requested local development workflow, 2026-11-02.

The owner/lead reviews the fixed catalog for one explicitly selected existing
workspace. The `orion-dev` additional module contributes a Workbench panel through
the existing generated module registry. Its hard dependencies are Projects and
Tasks. Disabling any required module closes import without deleting user data.
The Development capability retains ownership of mappings and ephemeral consents;
canonical projects, tasks and dependencies retain their existing owners.

The public API is preview → explicit review → consent → apply. Requests carry only
the snapshot digest, exact existing-ID choices, explicit workspace acknowledgement
and the one-use token. The authenticated actor and trusted catalog are server-owned.
Apply locks workspace, membership, projects and task graph before rereading state.
It recomputes the snapshot and selection hashes, consumes consent and performs
canonical mutations inside the same `withUser` transaction. Failed imports roll
back the token, entities, mappings, edges and canonical task events together.
Fixed owner projections now include project modification times, task revisions and
modification times, module settings and sorted dependency edges in the fingerprint.
No arbitrary Prisma delegates or neighboring concrete services are exposed.

New objects preserve phase and acceptance criteria in ordinary descriptions.
Adopted/mapped objects retain their descriptions. No import marks a task accepted,
starts an agent, or changes the independent execution/acceptance model.

Product brief: an owner wants to populate an existing development workspace while
preserving its projects and edits. Success is inspectable persisted canonical data
after reopening and a duplicate-free repeat import. The panel lists proposed,
mapped and candidate rows, their dependencies and acceptance criteria. Candidate
links open canonical objects for inspection; agreement uses native checkboxes.
The exact workspace name/ID and consequence remain visible before committing
(`rule/name-object-scope-consequence`, `rule/inline-before-modal`). One primary
import action follows all review choices (`rule/one-primary-action`). Requests are
never submitted on opening a panel. Loading, access denial, stale data, failure,
unknown write outcome and success have reachable recovery paths
(`rule/cover-reachable-states`, `rule/error-states-recovery`). Failed submissions
retain review choices; a successful refresh resets choices because they belong to
the prior snapshot (`rule/preserve-user-input`). After an uncertain apply response,
refresh is mandatory; the UI does not automatically repeat a write.
Requests have a 30-second UI deadline so a stalled transport leaves a retry path.
The deadline does not assert server cancellation; a timed-out apply still requires
a fresh preview. Ambiguous names and invalid bindings have explicit recovery copy.

Platform API 1.12.0 / integration contract 1.11.0 adds the registered module and
typed request/response schemas. The installer ships the fixed catalog inside its
API package, so application update payloads include it too. An administrator can
override the catalog root through server environment configuration only.
