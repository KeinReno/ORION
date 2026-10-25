# Contacts — записная книжка пространства

Публичные `public/contact-references.ts` и `public/contact-references.module.ts` дают соседям только
`existsTx(tx, workspaceId, contactId)`. Запрос выполняет собственный ContactReferenceReader в `.service.ts`;
проверяются id/workspaceId и исходный RLS, выбирается только id. SDK-модуль не запускает Contacts CRUD/cron
и не меняет доступность интерфейса. [ADR-0028](../../../../docs/adr/ADR-0028-contact-reference-reader.md).

Перенос межмодульных ссылок при merge выполняется через публичный Core EntityReferenceRegistry в той же транзакции. Таблицу Capture обновляет её владелец; ошибка обработчика откатывает merge целиком (ADR-0026).

Base module `contacts` (default-on). REST `/workspaces/:workspaceId/contacts`, `@RequireModule("contacts")`; the same `contacts` table «Дома» uses (`homeId` optional, deleting a home only drops the link).

**Data.** `kind` (person/organization), `organization`, `role`, labelled `phones`/`emails`/`links` (JSON arrays), `address`, `birthday` (`@db.Date`, year 1904 = «год неизвестен»), `tags`, `favorite`, `contactEveryDays`, `lastContactedAt`, `archivedAt`. `phone`/`email` stay as the *primary* value (first of the list) because «Дом» reads and writes them: `fieldsFromInput` keeps the two in sync, a lone primary write replaces the list, «Дом»'s own PATCH resets `phones`. Archived contacts stay in the list response (the client filters), stay in backups, and are hidden from a home's overview.

**Endpoints.** list/get/create/patch/delete; `POST bulk` (addTag/removeTag/archive/restore/favorite/unfavorite/delete, workspace-scoped); `POST import` (already parsed rows, `skipDuplicates` by phone/email/name); `POST :id/merge` (data via `mergeContactFields`, journal, relations, `entity_links`, `entity_reminders` and capture anchors move to the survivor, sources are deleted); `GET/POST/DELETE :id/interactions` (journal; `lastContactedAt` = latest entry that already happened, recomputed on delete); `GET/POST/DELETE :id/relations`.

**Relations** are their own table `contact_relations`: one row per pair with ids stored in sorted order (`CHECK contactAId < contactBId`, unique pair), one shared label; a repeated pair renames the label. `entity_links` cannot hold contact↔contact (the catalog rejects same-type pairs), hence the table.

**Reminders.** `ContactRemindersService` (hourly `@Cron`, `asSystem`): `contact_birthday` (once within 7 days before, once on the day) and `contact_followup` (once per due date = last contact + cadence). Asks `NotificationPolicyService.allowsForUser(owner, "contact")` (quiet hours only, no toggle yet); a policy-suppressed reminder is retried next tick. Dedup is the `(recipientId, eventKey)` index. Skips archived contacts and workspaces with the module off. Day math uses the server's local day.

**Pure logic** (tested, shared with the client): `packages/shared-types/src/contact.ts` (schemas, `nextBirthday`, `contactFollowUp`, `findContactDuplicates`, `mergeContactFields`, `contactMatches`) and `contact-io.ts` (vCard/CSV import and export, parsed in the browser). Web: `apps/web/lib/contacts.ts`, panel in `apps/web/panels/ContactsPanel.tsx` + `panels/contacts/*`; birthdays are a calendar source (`calendar-sources.ts`) and a dashboard block.

**Backup.** `Contact`, `ContactInteraction`, `ContactRelation` are `included` in the snapshot registry (parents before children). RLS (ENABLE + FORCE + workspace policy) on all three tables.

Tests: `packages/shared-types/src/contact.test.ts`, `apps/web/lib/contacts.test.ts`, `apps/web/lib/calendar-sources.test.ts`, `apps/api/test/contacts.integration.test.ts`, `e2e/contacts.spec.ts`. Not done: Google/phone sync (only file import), CRM funnel/deals (a separate optional extension per PRODUCT_DIRECTION), a per-user toggle for contact reminders.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `contacts` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `home` |
| Права (permissions) | `contacts.contact.read`, `contacts.contact.create`, `contacts.contact.update`, `contacts.contact.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `contacts` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/contacts` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/contacts/` |
| При выключении | Панель и API скрываются. Контакты сохраняются, а контакты домов по-прежнему видны и редактируются на странице дома. |
<!-- generated:manifest:end -->
