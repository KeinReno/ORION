# Workspace API

## Как сейчас (v1.0, зафиксировано)

- **Модель.** `Workspace` в `apps/api/prisma/schema.prisma`: `isPersonal` (:185), `syncMode` (`local|shared|hybrid`, :188,
  по умолчанию `shared`), `disabledModules` (:169), `restrictedModules` (:181), `pluginOverrides` (:174), `theme`.
- **Роли.** `owner | member | lead` (`workspaceRoleSchema`, `packages/shared-types/src/workspace.ts`). Права ролей — [PERMISSIONS.md](PERMISSIONS.md).
- **Сервис.** `WorkspacesService` (`apps/api/src/workspaces/workspaces.service.ts`): `listForUser`, `createForUser`
  (с шаблоном), `updateName`, `setTheme`, `deleteForUser`, `searchMembers`, `assertMember`/`assertMemberTx`, `assertMemberRoleTx`.
  Маршруты `workspaces.controller.ts`: `GET workspaces/me`, `POST workspaces`, `PATCH/DELETE workspaces/:workspaceId`,
  `PUT :workspaceId/theme`, `GET :workspaceId/members-search`.
- **Приглашения.** `apps/api/src/workspaces/invites.controller.ts` (`workspaces/:id/invites`, `invites/:token`, `:token/accept`);
  состояния `pending|expired|used|revoked`; веб-маршрут `/invite?token=`.
- **Модули и плагины пространства.** `GET workspaces/:id/modules`, `PATCH …/modules/:moduleId`, `PATCH …/modules/:moduleId/restrict`
  (`apps/api/src/modules/modules.controller.ts`); `GET workspaces/:id/plugins`, `PATCH …/plugins/:pluginId`
  (`apps/api/src/plugins/plugins.controller.ts`, только владелец).
- **Инвариант всех модулей:** маршрут `workspaces/:workspaceId/<ресурс>`; первым делом `assertMember` + `withUser` (CLAUDE.md).
- **Между пространствами:** гранты только на чтение четырёх типов (`note|document|project|transaction`,
  `packages/shared-types/src/shared-grant.ts`, `apps/api/src/shared/`); LAN host/client (ADR-0015, `apps/api/src/lan/`);
  перенос пространства — `apps/api/src/sync/workspace-transfer.service.ts`.

## Контракт v1.0 как есть

Компонент получает пространство, роль и состояние модулей через параметр маршрута, `request.user` и прямые вызовы
`WorkspacesService` / `ModulesService.accessibleSetTx` (импорт Nest-модуля). Отдельной поверхности «Workspace API для
компонентов» нет. На клиенте плагинам через `apps/web/lib/extensions/host-api.ts` доступны `useActiveWorkspace` и `useEnabledModules`.

## Целевое состояние

Узкий интерфейс для компонентов: текущее пространство, моя роль, включён ли компонент, участники (минимум), настройки
пространства, режим синхронизации — без импорта `WorkspacesService`. Состав и версия интерфейса входят в
`PLATFORM_API_VERSION`. Расширение грантов — через реестр, а не `z.enum` (G21).

## Не сделано

Выделенный интерфейс (аудит §2.7); смешанные пространства и рабочие сессии (`docs/STATUS.md`); типы грантов сверх четырёх (G21);
проверка на двух реальных установках/пользователях (G20, G21).
