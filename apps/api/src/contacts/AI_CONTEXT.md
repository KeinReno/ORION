# Context for the contacts module

Read MODULE.md first. «Дом» shares the `contacts` table and its `phone`/`email` columns: never drop or repurpose them, and keep `phones`/`emails` in sync through `fieldsFromInput` only. Every new column means a `toDto` change and a contract change in `shared-types/src/contact.ts`; response schemas have no `.default()`.

Every service method: `assertMemberTx` first, everything inside `withUser`, cross-record ids (`homeId`, relation `otherId`, merge `sourceIds`) checked against the same workspace (a user in two workspaces sees both through RLS). New tables need ENABLE + FORCE RLS in their migration and an entry in the snapshot registry and `snapshot.service.ts`.

Merge and bulk operations are single transactions; do not split them. Notifications for contacts are produced by the cron through `NotificationPolicyService` with an `eventKey`; actor-triggered notifications would have to go through `asSystem`. Birthday year 1904 means «unknown» — never show an age for it. «Day» values: date-only fields are UTC midnight (`@db.Date`), instants (`lastContactedAt`) are turned into the viewer's local day with `isoToLocalDayKey`, never `slice(0, 10)`. Calendar all-day pills carry UTC-midnight of their date.

Do not add CRM fields (pipeline, deal value) here — that is a separate optional extension. Do not add a UI library; the panel uses `@orion/ui` primitives only.

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/contacts` (за `@RequireModule("contacts")`); панель веба `contacts`; код `apps/api/src/contacts/`.
- Права: в манифесте не объявлены — действуют роли пространства (assertMember) и RLS.
- Модуль владеет: Контакты пространства (та же таблица, что у контактов «Дома»: контакт дома — это контакт с привязкой к дому).
- Соседи: жёсткие: —; мягкие: `home`; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: —.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->
