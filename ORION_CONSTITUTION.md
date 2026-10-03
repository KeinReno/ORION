# ORION Architecture Constitution

This file contains the repository-level architectural invariants. Detailed ownership and migration decisions live in `docs/AI_REFACTOR_MIGRATION_MAP.md`.

## Invariants

1. **Core is platform infrastructure, not domain business logic.**
   Core may provide auth, users, workspaces, permissions, events, storage, registries, navigation shell, background jobs, settings infrastructure, diagnostics and lifecycle management. Core must not own Tasks/Finance/Documents/Projects business rules.

2. **A Base Module is the stable minimum of one domain.**
   Base must remain independently useful when optional plugins and neighboring modules are disabled.

3. **Optional/advanced complexity belongs behind capabilities.**
   New views, analytics, collaboration, planning, integrations and specialized workflows should be implemented as plugins/extensions unless they are truly universal to the Base domain.

4. **Plugins never patch Base internals.**
   Plugins communicate through public contracts, SDKs, events and registered extension points.

5. **Base Modules never import concrete plugins.**
   Composition is performed by registries/runtime, not by `if (pluginX)` imports scattered through module code.

6. **Modules do not read another module's internals.**
   Cross-domain behavior is a Module Bridge / public integration contract.

7. **Frontend extensions use typed UI slots.**
   A plugin does not choose an arbitrary React insertion point. It registers a contribution in an allowed slot whose contract constrains what can be rendered there.

8. **No slot means no silent Base modification.**
   If a required extension point does not exist, create an Extension Proposal (`NEW_EXTENSION_POINT_REQUIRED`) and review it as an architectural change.

9. **Public contracts are versioned boundaries.**
   Breaking contract changes require an explicit migration/version decision.

10. **Architecture is enforced mechanically.**
    CI/lint/tests must reject forbidden imports, unknown extension points, invalid manifests, circular mandatory dependencies and contract violations.

11. **AI agents receive minimum sufficient context.**
    Read canonical architecture docs + target module passport/contracts before implementation. Do not rely on the whole repository as an implicit architecture specification.

12. **Architecture refactor preserves product parity.**
    Refactoring Core/Module/Plugin ownership is not a redesign. With the standard built-in extensions enabled, ORION after migration must preserve the current effective UI and behavior. Existing data and workspace capability state must be migrated without silent loss.

13. **A smaller Base must not mean a poorer default product.**
    Rich built-in functionality may move into default-enabled built-in plugins. Users can then disable capabilities to simplify ORION without requiring separate forks such as “Tasks Pro”.

14. **Disabled does not mean deleted.**
    Disabling a module/plugin must preserve user data unless the user explicitly performs a destructive data-removal action.

15. **Do not combine architectural extraction with unrelated redesign.**
    First reach parity. UX simplification, data-model redesign and product changes happen as separate, explicit phases.

## Required reading

- `AGENTS.md`
- `docs/MODULES_AND_PLUGINS.md`
- `docs/AI_FIRST_EXTENSION_ARCHITECTURE.md`
- `docs/AI_REFACTOR_MIGRATION_MAP.md`

These documents together define the current target architecture.
