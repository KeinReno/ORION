# ADR-0034 — Completing the remaining module boundaries

Status: accepted for implementation, 2026-10-26.

The baseline has 17 service files with explicit boundary exceptions. Remove them
by moving each query to its existing data owner and exposing purpose-specific
projections or commands. Ownership follows AI_REFACTOR_MIGRATION_MAP.md.

Goals is the first stage. Its task history, task pulse and milestone projections
belong to Tasks and Milestones. Project progress continues to use the existing
project DTO calculation and registered aggregates. Public modules must not load
controllers, scheduled work or unrelated domain modules.

Subsequent stages cover bridges, references, read aggregations and agent commands.
Each stage preserves request authorization, workspace filters, transaction/RLS
context, errors, ordering, persisted data and default-full behavior. A port is
not a generic Prisma delegate, and relocating a query into an unchecked helper
does not satisfy the boundary.

After each stage run the architecture check, API typecheck and focused regression
tests. Finish with full lint, typecheck, unit/integration and browser smoke checks,
including disabled-extension behavior. Record actual results in a current report;
do not count unexecuted checks as acceptance.
