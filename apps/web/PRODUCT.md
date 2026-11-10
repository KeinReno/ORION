# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

ORION is a personal and shared software environment for individuals, families, and small teams. Users assemble a workspace from the modules they need and use it for projects, tasks, notes, documents, calendar, finance, knowledge, goals, health, home, and other supported domains. This audience and operating model are confirmed by the owner-approved `docs/PLATFORM.md` and `docs/MODULES_AND_PLUGINS.md`.

## Product Purpose

ORION provides one coherent local-capable platform in which independently useful modules share navigation, workspaces, windows, search, notifications, themes, permissions, and data relationships. Success means a user can move between domains and configure a simpler or richer workspace without losing data or experiencing a fragmented product.

## Positioning

ORION is a configurable platform rather than a fixed all-in-one application or a collection of separate forks. Core supplies shared infrastructure; modules own independent domains; typed extension points and plugins add optional capabilities; bridges connect domains through public contracts.

## Operating Context

The primary interface is a rich React web application also delivered inside a Windows Tauri shell. Users work in one or more workspaces, dock panels, split views, detachable windows, and narrow responsive layouts. Both solo and shared workspaces are normal configurations. Optional modules and plugins may be disabled without deleting their data.

## Capabilities and Constraints

- Preserve the existing product experience, module behavior, routes, panel actions, data, and default-full feature profile.
- Use the shared design system and public UI extension contracts; do not introduce cross-module internal imports or plugin-specific Base dependencies.
- Modules must remain visually coherent without being hard-bound to one palette; ready-made and user-created color themes are product requirements.
- Content width follows the task: readable prose, settings, feeds, wide tables, boards, calendars, timelines, and canvases need different measures.
- Drag interactions require keyboard and menu alternatives. Disabled, absent, denied, loading, empty, error, deleted, and conflict states must remain truthful.
- Current product priority is Stage 0: finish the redesign, unify the interface, and stabilize existing behavior.

## Brand Commitments

The product name is KAIDEN ORION / ORION. The owner explicitly requests a recognizable, distinctive visual language applied consistently across all sections, cards, sidebars, and components. Existing product copy, domain terminology, functionality, and technical constraints remain authoritative.

## Evidence on Hand

- Owner-approved product direction: `docs/PLATFORM.md`.
- Current frontend UX requirements: `docs/FRONTEND_WORKSPACE_SPEC.md`.
- Current implementation status: `docs/STATUS.md`.
- Existing theme and component implementation: `packages/ui/src`, `apps/web/app/globals.css`, and `apps/web/panels`.
- Existing theme and surface contracts: `docs/platform-api/THEMES.md` and `docs/platform-api/SURFACES.md`.
- No new customer claims, testimonials, metrics, or market proof may be invented for interface copy.

## Product Principles

- One platform, one coherent user experience, independently useful modules.
- Preserve user data and effective capabilities when configuration changes.
- Shared contracts and primitives instead of repeated local UI inventions.
- Content and the user's current task determine layout density and width.
- Rich functionality remains available without making the default interface visually chaotic.

## Accessibility & Inclusion

Meet WCAG-oriented contrast and accessible-name requirements, preserve visible keyboard focus, support keyboard equivalents for pointer and drag actions, and verify both viewport and dock-panel widths at 390, 768, 1171, and wide desktop sizes. Do not use low contrast, tiny text, or hidden primary content as a way to fit dense interfaces.
