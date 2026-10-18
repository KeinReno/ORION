# Permission API (G12) — спецификация

Статус: **спецификация, кода нет.** Реализация — этап 3 (после G1), на базе агентской матрицы прав.

## Как сейчас (v1.0, зафиксировано)

Единого Permission API нет: пять независимых механизмов (аудит §2.10).

| # | Механизм | Что решает | Где в коде |
|---|---|---|---|
| 1 | Роли пространства `owner` / `lead` / `member` | кто управляет пространством; владелец-только переключатели плагинов и модулей | `workspaceRoleSchema` (`packages/shared-types/src/workspace.ts`); `WorkspacesService.assertMember`/`assertMemberRoleTx` (`apps/api/src/workspaces/workspaces.service.ts`); `PluginsService.setEnabled` (`apps/api/src/plugins/plugins.service.ts`, «Только владелец может менять состав плагинов») |
| 2 | `restrictedModules` | модуль виден `owner`/`lead`, но скрыт от `member`; это фильтр видимости, не RLS | `Workspace.restrictedModules` (`schema.prisma:181`); `ModulesService.assertEnabledTx` / `accessibleSetTx` (`apps/api/src/modules/modules.service.ts`); `ModuleEnabledGuard` + `@RequireModule` (`apps/api/src/modules/`) — выключенный модуль даёт 409 |
| 3 | `HealthGrant` | доступ участника к данным «субъекта здоровья» (`level`, по умолчанию `read`); правило повторено в RLS | `model HealthGrant` (`schema.prisma:2597`); `apps/api/src/health/health.service.ts`; ADR-0012 |
| 4 | Приватные счета финансов (`visibility: workspace\|private`) | приватный счёт скрыт от всех, кроме создателя, на уровне БД | `accounts.service.ts` (`apps/api/src/finance/accounts/`), миграция `20261015138000_private_accounts`; тест `finance-private-accounts.integration.test.ts` |
| 5 | Агентские scope'ы, матрица, режимы | что может токен агента | `AGENT_SCOPES` (11), `AGENT_PERMISSION_MODULES`/`AGENT_PERMISSION_OPS`, `AGENT_MODES`, `AGENT_FORBIDDEN` в `packages/shared-types/src/agent.ts`; `decideAgentOperation`, `permissionsFromScopes`, `scopesFromPermissions` в `agent-policy.ts`; `AgentTokenGuard` (`apps/api/src/ai/agent-token.guard.ts`) |

Дополнительно, шестой по сути: кросс-пространственные гранты только на чтение (`CrossWorkspaceGrant`; типы
`note|document|project|transaction` — `packages/shared-types/src/shared-grant.ts`, `apps/api/src/shared/`).

Общее ядро изоляции — `assertMember` + RLS по пространству (`PrismaService.withUser`); оно остаётся основой и не
заменяется. Манифест имеет поле `permissions: string[]` (`component-manifest.ts`), сегодня пустое и рантаймом не читается.
Плагин не декларирует нужные операции; проверок «плагин без права получает 403» нет (критерий 10 PLATFORM.md не выполнен).

## Целевое состояние

### Словарь разрешений

Формат: `<module>.<resource>.<action>`, где `module` — id модуля (`ORION_MODULE_IDS`) или `core`; `action` из набора
`read | create | update | delete | propose | manage`. Три сегмента обязательны; двухсегментный пример `tasks.read` в комментарии
схемы манифеста считается устаревшим и заменяется на `tasks.task.read` при реализации (breaking для манифеста — до
реализации это допустимо, поле пусто).

Начальный список выводится из существующих агентских scope'ов (`AGENT_SCOPES`):

| Scope агента | Разрешения словаря | Примечание |
|---|---|---|
| `tasks:read` | `tasks.task.read` | |
| `tasks:write` | `tasks.task.create`, `tasks.task.update` | в матрице агента `create`/`update`; режим `assistant` превращает `update` в `propose` |
| `notes:read` | `notes.note.read` | |
| `notes:write` | `notes.note.create`, `notes.note.update` | |
| `projects:read` | `projects.project.read` | |
| `events:read` | `calendar.event.read` | scope называется `events`, модуль — `calendar` (`CAPTURE_MODULE`/каталог модулей) |
| `events:write` | `calendar.event.create`, `calendar.event.update` | без удаления и без правил повторения (`agentEventPatchSchema`) |
| `finance:draft` | `finance.draft.propose` | записывает только человек; `AGENT_FORBIDDEN` содержит `finance` |
| `links:write` | `core.link.create`, `core.link.delete` | связи `EntityLink` (`SearchService.createLink/removeLink`) |
| `agents:message` | `core.agent_message.create` | |
| `agents:delegate` | `core.agent_job.create`, `core.agent_job.update` | |
| (всегда запрещено) | `*.*.delete` | флаг `delete` в `AGENT_FORBIDDEN`: агент лишь предлагает удаление |

Человеческие операции получают те же имена (например `finance.account.update`) постепенно, по мере декларации в
манифестах; полный список всех операций сегодня не составлялся.

### Декларация в манифесте

`permissions` в `ComponentManifest` — список разрешений, **которые компонент предоставляет** (свои операции) и
**которые ему нужны** от других. Предложение: два массива `permissions.provides` / `permissions.requires`
(изменение схемы манифеста, не сделано). Плагин, расширяющий модуль, получает только то, что перечислил в `requires` и
что владелец пространства подтвердил при включении (сегодня «включение плагина» — один переключатель владельца).

### Точка принуждения

- Серверный декоратор `@RequirePermission("tasks.task.update")` рядом с `@RequireModule` (`apps/api/src/modules/require-module.ts`)
  и guard по образцу `ModuleEnabledGuard`: проверяет модуль включён и доступен роли, затем разрешение субъекта
  (роль → набор разрешений; плагин → его `requires` ∩ подтверждённое; агент → производное от scope'ов).
- Субъект — одно из `user(role)`, `plugin(pluginId, действуя от user)`, `agent(token)`. Агент и плагин **никогда не расширяют**
  права действующего пользователя (как сегодня у токена: «acts with that member's rights», комментарий в `agent.ts`).
- RLS и `assertMember` остаются нижним уровнем; `@RequirePermission` — верхний, по операции.
- Отказ — 403 с телом `{ code: "permission_denied", permission }`; выключенный модуль — по-прежнему 409.

### Отображение агентских scope'ов

Scope — набор разрешений из таблицы выше; `AGENT_SCOPES` становится выведенным из реестра разрешений (G13, G12), а
`AgentPermissionModule × AgentPermissionOp` — проекцией словаря (`tasks.task.read` → `tasks`+`read`). Режимы
(`observer/assistant/manager`) остаются сужающим слоем поверх (`decideAgentOperation`). Тесты «инструмент ↔ маршрут» для
`AGENT_TOOLS` сохраняются.

Что остаётся вне словаря на 1.0: `HealthGrant` (уровень на субъекте, не на операции), `private` счета и `CrossWorkspaceGrant` —
это **модели видимости данных**, решаемые RLS; словарь разрешений отвечает на «можно ли операцию», видимость — на «какие
строки». Их связь с Permission API — отдельное решение.

## Не сделано

Реестр разрешений в `shared-types`; поля `permissions` в манифестах; `@RequirePermission` и guard; сопоставление ролей
наборам разрешений (сегодня права по модулям не привязаны к роли, только «ограничен для member»); вывод `AGENT_SCOPES`
из словаря; тест «плагин без разрешения → 403»; подтверждение владельцем набора разрешений плагина.
