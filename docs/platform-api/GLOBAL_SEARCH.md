# Global Search: единый вход и провайдеры

Задание 10.2. Поиск — **поверхность ядра**: `SearchService` не знает таблиц
предметных модулей и агрегирует только провайдеров, зарегистрированных
владельцами. Модуль, выключенный в пространстве, не опрашивается вовсе.

Состояние: реализовано (11.11.2026); существующий маршрут
`GET /workspaces/:id/search` сохранён без изменений.

## Маршрут

```text
GET /search?workspaceId=&q=&types=&from=&to=&limit=
```

- `q` — обязательный, от 2 символов (короткий запрос всё равно проверяет
  членство и возвращает пустой список, а не 403-подмену);
- `workspaceId` — обязательный; членство проверяется до любого провайдера;
- `types` — `task,note,knowledge_item,…` (закрытый список
  `SearchableEntityType`; неизвестный тип — 400);
- `from`/`to` — окно по `updatedAt` включительно; `to` в виде `ГГГГ-ММ-ДД`
  включает весь день;
- `limit` — 1…100, по умолчанию 20.

Ответ: `{ query, workspaceId, results: GlobalSearchHit[] }`, где
`GlobalSearchHit` = поля прежнего `GlobalSearchResult` (`id`, `type`, `title`,
`subtitle`, `matchedText`, `projectId`, `updatedAt`) плюс:

- `module` — id модуля-источника (`SEARCH_TYPE_MODULE`);
- `moduleLabel` — метка для интерфейса из `MODULE_CATALOG`;
- `deepLink` — `{ workspaceId, entityType, entityId }`; это адрес записи по
  контракту навигации (совпадает по смыслу с `ObjectRef`), а не право доступа.

## Контракт провайдера

```ts
interface SearchProvider {
  readonly entityType: SearchableEntityType;
  readonly componentId: OrionModuleId;
  search(tx, workspaceId, query, limit): Promise<GlobalSearchResult[]>;
}
```

Провайдер живёт в директории модуля-владельца и регистрируется в `onModuleInit`
через `SearchProviderRegistry` (`apps/api/src/search/search-provider.registry.ts`);
регистрация второго провайдера того же типа падает при старте. Провайдер
получает уже открытую `withUser`-транзакцию после проверки членства и сам
применяет свои правила видимости (RLS — вторая линия, но не замена правилам
модуля). Порядок склейки фиксирован `SEARCH_PROVIDER_ORDER`, чтобы выдача не
зависела от порядка инициализации Nest.

Провайдеры зарегистрированы для: проектов, задач, заметок, материалов базы
знаний, событий, документов, операций и счетов финансов, контактов, списков,
целей, целей накопления и записей журнала проектов.

### Материал базы знаний

`KnowledgeSearchProvider` (`apps/api/src/knowledge/knowledge-search.provider.ts`)
использует тот же материализованный `searchVector` (tsvector, задание 06), что
и собственный поиск Knowledge. В выдачу не попадают архивные материалы и
приватные материалы другого автора (`visibility = 'private'` видит только
`createdBy = current_setting('app.current_user_id')`). Подзаголовок — вид
материала (метод/инструмент/факт/мнение/ссылка), `matchedText` — `ts_headline`.

## Права и выключенные модули

`SearchService` строит набор доступных типов через
`EntityLinksService.accessibleTypesTx` → `SEARCH_TYPE_MODULE` и
`ModulesService.accessibleSetTx`. Поэтому:

- выключенный модуль не опрашивается (провайдер не вызывается);
- модуль, ограниченный для обычного участника (`restrictedModules`), не
  отдаёт результаты этому участнику;
- `types` сужает выдачу поверх этого набора, но не расширяет её.

Инфраструктура не подменяет права провайдера: если модуль считает запись
недоступной, её не будет и в общем поиске.
