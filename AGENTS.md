# ORION — instructions for AI development agents

This file is the mandatory entry point for AI agents working in this repository.

## Read before changing code

Read in this order:

1. `docs/MODULES_AND_PLUGINS.md`
2. `docs/AI_FIRST_EXTENSION_ARCHITECTURE.md`
3. `docs/AI_REFACTOR_MIGRATION_MAP.md`
4. the target module's local `MODULE.md` and `AI_CONTEXT.md` when they exist
5. the public contracts / SDK / extension points used by the task

Do not treat missing context as permission to infer architecture from nearby implementation code.

## Core rule

ORION follows:

```text
Core → Contracts / SDK → Modules → Extension Points → Plugins
```

Dependencies must not point backwards toward concrete plugins.

- Core must not know concrete plugins.
- Base Modules must not import concrete plugins.
- Plugins use public contracts only.
- Cross-module behavior uses public contracts/events/bridges, not internal imports.

## Migration ownership is already decided

During the current refactor, `docs/AI_REFACTOR_MIGRATION_MAP.md` is authoritative for what is Core, Base, Plugin and Module Bridge.

Do not spend task time reclassifying listed functionality.

If you believe the map must change, create an ADR / Extension Proposal and explain why. Do not silently change ownership.

## Parity rule: architecture refactor is not a redesign

The current rich ORION experience must survive the refactor.

With the standard built-in extensions enabled, post-refactor ORION must reproduce the pre-refactor UI and behavior as closely as practical.

Features extracted from currently built-in always-visible behavior must normally be enabled in the default-full profile. Existing truly optional plugins keep their existing defaults unless an explicit product decision changes them.

Do not combine plugin extraction with unrelated UX redesign, schema redesign or API redesign.

## Plugin rule

When adding optional or advanced functionality, prefer a plugin contribution instead of growing Base.

If the required extension point does not exist:

```text
NEW_EXTENSION_POINT_REQUIRED
```

Create an Extension Proposal. Do not patch an arbitrary location in the Base Module.

## Frontend rule

Plugins attach only through registered typed UI slots / contribution points.

Forbidden pattern:

```ts
import SomethingInternal from "../../modules/.../internal/...";
```

Preferred pattern:

```ts
import { ... } from "@orion/<module>-sdk";
import { ... } from "@orion/plugin-sdk";
import { ... } from "@orion/ui";
```

The Base Module owns layout. The Design System owns UX language. The registry owns extension composition. Plugins provide contributions.

## Scope discipline

- Modify only the target module/plugin and required public contracts.
- Do not opportunistically refactor unrelated modules.
- Prefer one extraction concern per PR/commit.
- Preserve existing persisted data unless migration is explicitly part of the task.
- Do not delete disabled-plugin data by default.

## Required checks

Run the available equivalents of:

```text
lint
typecheck
tests
architecture-check
plugin-contract-check
visual/smoke parity checks
```

A change is incomplete if the host Base Module stops working with the plugin disabled or if the default-full configuration no longer matches the current ORION experience.
