# Goal planning projections

ADR: [0034](../adr/ADR-0034-module-boundary-completion.md).

Goals reads `ProjectCatalog.list` for canonical project DTOs and owner-registered
aggregates. ProjectCatalogModule shares the existing ProjectsService instance with
ProjectsModule, without importing its controllers, TasksModule or CapturesModule.

`GoalTaskReader.historyTx` returns project/status/lifecycle dates; `plansTx` returns
planning fields and dependency statuses. `GoalMilestoneReader.plansTx` returns ordered
milestones. Implementations remain owner .service.ts files under architecture checks.
All projection queries retain workspaceId and the caller transaction/RLS. Readers do
not grant access or change module policy. Goals keeps its existing membership guards,
archived projects, ordering and progress calculations. ProjectReferences validates
new plan links in the existing write transaction.

Acceptance: goals integration tests cover progress, history, milestones, blockers,
hierarchy, foreign spaces and projection transaction visibility/rollback.
