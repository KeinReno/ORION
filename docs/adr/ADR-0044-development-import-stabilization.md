# ADR-0044 — ORION DEV import stabilization boundaries

Status: Accepted for the owner-requested stabilization, 2026-11-02.

ORION DEV is a normal workspace; the Development capability owns only catalog
bindings and short-lived consent records. Projects, Tasks and dependencies retain
their existing owners. No parallel task store, Core exemption or ownership-map
reclassification is introduced.

CLI and API use one pure planner shipped by shared-types. API authentication,
explicit workspace selection, HTTP errors and consent remain server concerns.
The CLI can additionally propose a workspace; that proposal never authorizes writes.

Owner public catalog projections provide fixed workspace-scoped reads, not arbitrary
Prisma delegates. Task creation and dependency changes use TaskOperations in the
original transaction, including canonical revision checks and transactional events.
The existing public TaskOperations gains its owner's existing updateTx operation.
Development metadata is durable; consent is ephemeral and excluded from restore
and synchronization. Models stay outside other modules' generated Prisma regions.

No public import endpoint is authorized by the existence of internal helpers.
Revalidation, single-use consumption, mutations and result must be one serialized
transaction before such an endpoint is enabled. Workspace data must not be populated
from source inspection or a name match alone.
