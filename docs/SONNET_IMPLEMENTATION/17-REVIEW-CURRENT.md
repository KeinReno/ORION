# Независимая проверка прогресса Sonnet

Снимок: 2026-09-21, около 20:10 Europe/Moscow. Проверяющий: Codex.
Прикладной код не менялся. Это выборочная проверка текущего рабочего дерева;
она не заменяет полную приёмку. Новые правки могут сделать выводы устаревшими.

## Реальный прогресс

По журналу: 7 DONE, 7 PARTIAL, 9 TODO из 23 карточек. Это статусы задач,
не процент готовности продукта. В коде подтверждены actor-aware module access,
owner-only sync gates, snapshot v2 и blob backup/recovery, actor time entries,
recipient notifications, discriminated session state, pending intents,
day-boundary helpers, autosave controller и revision-based update заметок.
Есть новые integration test suites по этим направлениям; самостоятельно они
в этой проверке не запускались. Результаты прежних прогонов — заявления журнала.

Самостоятельные проверки:

- `corepack pnpm test`: PASS, 18 файлов / 171 тест; было 13 / 135.
- `corepack pnpm typecheck`: FAIL, DocumentsService:240 и :244, TS2339,
  свойства toKey/fromKey у never. API-проверка останавливает общий gate.
- Production build, desktop export и browser E2E заново не запускались.

## R01 · P1 · Текущий typecheck красный

`apps/api/src/documents/documents.service.ts:240` и `:244`.
Переменная moved назначается внутри async callback Prisma-транзакции;
TypeScript не учитывает это присваивание при сужении типа в catch.
Исправить модель хранения результата/компенсации без any и проверить целевой
documents integration test, затем общий typecheck. Изменения документов и
миграция unique names уже есть, хотя S14 пока TODO; возможно, это незавершённая
текущая работа, а не заявленный законченный результат.

## R02 · P1 · Восстановление заметки обходит revision-инвариант

`apps/api/src/notes/notes.service.ts:restoreRevision` меняет title/body/tags,
но не увеличивает revision. Сценарий: редактор A читает revision N; B
восстанавливает историческую версию; A сохраняет с expectedRevision=N —
CAS пропускает запись, восстановленный текст затирается без конфликта.

Любое изменение content, включая restore, должно атомарно увеличивать
revision; restore также требует определённой conflict policy.
Добавить интеграционный сценарий restore→stale update. Отдельно expectedRevision
сейчас optional и фильтр revision условный: клиент без этого поля может
обойти CAS. Допустимо лишь как временная миграционная стадия, не финальная защита.

## R03 · P1 · Уведомления пока не соблюдают module restrictions

`NotificationCenterService.list` проверяет membership+recipient, но не
актуальный доступ к домену. `createTx` также проверяет membership, а не
restrictedModules. DueTaskChecker фильтрует disabled tasks, но не запрет
tasks для конкретного recipient.

Сценарий: C member получил уведомление с названием задачи; owner ограничил
tasks для members; C всё ещё может прочитать ранее сохранённый title/body.
Проверить и закрыть чтение и создание/доставку после restriction. Адресность
и readAt исправлены, но S01/S07 целиком DONE объявлять преждевременно.

## R04 · P2 · S09 закрыта только частично

Pending intent и late subscriber действительно реализованы. Но текущие
panel-bus/intent-channel не реализуют URL adapter и browser history,
которые входят в исходную карточку. Scope проверяется для pending intent;
live listener получает только value, поэтому нужен отдельный тест смены
workspace при смонтированных панелях. React/E2E проверка отсутствует.

В журнале написано, что панели не используют next/dynamic. Это неверно:
`apps/web/lib/panel-registry.ts` импортирует dynamic и объявляет Lazy*Panel.
Исправить описание и проверить реальный cold-open, не только pure helper.

## R05 · P2 · Визуальная часть в основном ещё впереди

Есть точечные UI изменения: ошибки независимых блоков Dashboard,
team-default задач, список/доска, focus helper, conflict UI. Но screenshots,
responsive/zoom/contrast и основной визуальный проход не сделаны. В globals.css
остаётся двойное compact уменьшение root 16→14px и body .9375→.875rem,
то есть 15→12.25px. S12 PARTIAL соответствует реальности.

## Приоритет следующего шага

1. Закончить текущую documents правку и вернуть зелёный typecheck.
2. Исправить R02/R03, довести проверки revision и access до всех путей.
3. Закрыть S22 (desktop export) и S21 (дубли recurring/inbox), которые
   всё ещё TODO, вместо дальнейшего последовательного продвижения по номерам.
4. Довести S04 stale-preview/restore consistency и остальные PARTIAL.
5. Пройти живую UI-проверку, затем продолжать визуальные/новые функции.

Журнал содержит около 1800 строк; будущим сессиям читать таблицу очереди и
релевантный раздел, не весь журнал каждый раз. Историю не удалять, но полезно
вынести подробные execution logs по отдельным задачам после текущей работы.
