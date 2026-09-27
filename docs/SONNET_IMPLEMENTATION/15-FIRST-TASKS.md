# Первые задачи: конкретная схема реализации

Этот документ снижает количество решений, которые придётся заново принимать Sonnet. Псевдокод не копировать как готовый patch: сигнатуры сверить с текущим исходником. Не требует переписывания приложения.

## S01: regression tests до исправления

Создать отдельный integration test либо расширить существующий suite, соблюдая его cleanup. Рекомендуемые названия ниже — целевые, сейчас таких тестов нет.

### `restricted-module-aggregate-access`

Fixture:

1. A owner и C member workspace W.
2. Finance включён, restrictedModules содержит finance.
3. Project P, finance transaction F с уникальной строкой `restricted-finance-probe`, суммой 123456 minor units.
4. Task T доступен C, entity link T→F.

Проверки:

- C GET finance endpoint → 403.
- C GET search?q=restricted-finance-probe → нет F и marker нигде в serialized payload.
- C GET projects/P → нет amount/financial activity F; запретить ложное использование настоящих агрегатов даже если UI их скрывает.
- C GET links?type=task&id=T → нет title F.
- C POST links T→F → отказ, не создаётся link.
- A выполняет те же reads и видит разрешённые данные.
- После выключения finance direct owner endpoint → 409, aggregates тоже не читают finance.

Дополнить аналогом documents: filename marker, note attachment, document version. В `NoteAttachmentsService.list` сейчас documents access не проверяется, хотя attach/upload проверяется — это отдельный regression.

### Минимальная последовательность изменения

1. Получать membership и module config один раз на transaction.
2. Сформировать accessible modules с учётом disabled и restricted/role.
3. Передать set в private Project rollup/activity helpers; в вызывающем get/list иметь userId.
4. Search использует accessible set до queries.
5. Links проверяют обе стороны; unavailable side не вызывает entityTitle напрямую.
6. Attachment list проверяет documents и notes; договориться между 403 и пустой секцией на уровне endpoint. Рекомендация: прямой endpoint →403, UI скрывает секцию по capabilities.
7. DTO и cache invalidation меняются атомарно с UI, если поля стали nullable/visibility-aware.

Не применять policy через новый отдельный Prisma connection внутри текущей транзакции. Не использовать `asSystem` для пользовательского агрегатора.

## S02: полный перечень owner gates

Проверить public методы SyncService: getRemote, putRemote, testRemote, backup, listBackups, restore; приватный openRemote часто удобная общая точка, но она не покрывает backup/putRemote, если они её обходят. Поэтому тестировать каждый endpoint отдельно.

Owner проверяется до расшифровки remote secret и до внешнего сетевого вызова. Test spy/stub должен доказать, что rejected actor не вызывает remote. На restore apply повторная проверка внутри транзакции нужна даже если preflight был успешен.

UI не должен вызывать owner-only hooks для member, чтобы не создавать постоянно красные 403 запросы в фоне. Прятать кнопку без server gate недостаточно.

## S03: coverage test без ручного самообмана

Реестр моделей хранит имя Prisma model/table, snapshot key, policy и причину exclusion. Тест получает реальные модели из Prisma metadata/schema и сравнивает множества. Проверять не только наличие workspaceId, но и зависимые данные файловых версий/identity references.

Пример assertion (псевдокод):

```text
allWorkspaceModels - explicitlyClassifiedModels == empty
includedKeys unique
every referenced included parent precedes child OR deferred insertion pass exists
excluded cascaded child has explicit restore policy
```

Самоссылки Task.parentId и Document.parentId требуют отдельного порядка вставки/двухфазной загрузки. Не считать порядок возвращённого findMany топологическим. Сначала проверить возможности batch insert и FK фактической БД; добавить тест дерева глубиной 3+ и shuffled snapshot rows.

Legacy snapshot v1: нельзя знать, означает ли отсутствие ключа «в старой версии не было модуля» или «потеряна таблица». Поэтому политика fail-closed для разрушительной замены обоснованна. Оставить просмотр состава старой копии и экспорт её читаемых данных; автоматический upgrade не должен создавать отсутствующие сведения.

## S06: миграция времени

Этапы:

1. Nullable userId, optional author DTO; сервер новых записей заполняет actor, клиент не может подменить.
2. Отчёт legacy running rows. Если ровно известный автор отсутствует, не приписывать owner автоматически. Предоставить admin resolution в миграционном runbook.
3. Удалить старый workspace-running unique index и создать новый partial composite index в контролируемой миграции.
4. Queries running/stop/update включают userId/ownership; admin correction идёт отдельным контрактом.
5. Сводки различают mine/team/unknown-author; суммы legacy входят в общие отчёты.
6. Snapshot serializes user refs по explicit identity policy; restore не создаёт случайных user IDs.

Граничное решение: ограничение одного running timer **на user+workspace**, не глобально на аккаунт. Если нужен глобальный таймер между пространствами — это отдельное изменение продукта, не додумывать.

## S08: session state

Нынешний `useSession` возвращает только user/isLoading и поглощает ошибку в null. Целевой discriminated state может быть:

```ts
type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'unauthenticated' }
  | { status: 'unavailable'; previousUser?: SessionUser; retry: () => void };
```

Это sketch: совместимость существующих consumers обеспечить переходным adapter. При unavailable не предоставлять новые права по stale user и не утверждать authenticated; сохранять локальную работу и показывать reconnect surface. При окончательном 401 убрать чувствительный cached content, сохранив private draft только по принятой локальной политике.

## S09: lost intent

Два теста с deferred component load:

1. focusTask(X) → openPanel запускает lazy import → emit до mount → mount → ожидаем X selected.
2. Пока грузится X в W1, пользователь переходит в W2 → старый X не применяется.

Не решать проблему `setTimeout(500)`: latency произвольна. Нужен pending state + readiness subscription, scope и acknowledgement. Один retained intent на канал обычно достаточно для последнего клика; подтверждённый старый intent удаляется.

## S11: autosave trailing drain

Тест с fake timers и controlled promises:

1. Ввести A, advance debounce, запрос A pending.
2. Ввести B, advance debounce, запрос A всё ещё pending.
3. Resolve A. Ожидать новый запрос B без дополнительного ввода.
4. Ввести C пока B pending; итоговый server content C и indicator saved только после его acknowledgement.
5. Reject B: C остаётся draft, error явно виден, retry отправляет актуальный snapshot с правильной revision.

Подход: хранить latest snapshot и lastAcknowledged snapshot; не более одного in-flight save; после завершения сравнить их и drain pending snapshot. Revision обновляется только ответом успешного CAS. Ошибка прекращает автоматическую бесконечную ретрай-петлю, даёт recoverable state. Перед отправкой проверяется entity/workspace identity, после unmount запрос не обновляет чужой editor.

## S21: recurring occurrence

Чтение due rules — лишь кандидаты. Внутри транзакции lock конкретной rule, re-read paused/nextRunAt/module state; уникальный occurrence key остаётся последним барьером. Использовать scheduled timestamp, не время запуска cron. Advancement привязан к успешно созданному/уже существующему occurrence.

Два worker запускаются через barrier одновременно. После окончания: ровно одна Transaction, nextRunAt сдвинут на один occurrence. При fault между insert/advance транзакция откатывается; следующий run повторяет без дублей. Downtime catch-up ограничен batch size и наблюдаемым прогрессом.

## Не пропустить после первых исправлений

- `auth.module.ts` имеет fallback JWT secret: server mode должен fail-fast, development fallback не попадает в release.
- `useLogout` удаляет workspaces query, но не весь private cache: протестировать accounts/notifications/preferences между разными пользователями, не объявлять утечку без reproduction.
- В `WorkspaceMembersService` owner count/role change проверить конкурентно; lead не должен удалять другого lead по новой матрице.
- Любой новый file/model/recipient contract отражён в snapshot registry и migration runbook.
