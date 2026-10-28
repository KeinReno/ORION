# Архив чатов — модуль, подключённый манифестом

Разговоры с ИИ-агентами в исходном виде: транскрипт сохраняется построчно и без изменений, рядом — извлечённый текст для
чтения и поиска. Собран генератором `pnpm create:module` (см. [`docs/DEV_KIT.md`](../../../../../docs/DEV_KIT.md)).

## Модель

- **Разговор** (`ChatArchiveConversation`) — один файл транскрипта: источник (`claude-code` | `codex`), id сессии в источнике,
  папка проекта, заголовок, число строк и сообщений. Уникален по `(пространство, владелец, источник, id сессии)`.
- **Строка** (`ChatArchiveLine`) — строка файла под своим номером `seq`: `raw` как есть, `sha256(raw)`, роль/вид и текст из
  `parseChatArchiveLine` (`shared-types/.../chat-archive/parse.ts`). Оригинал = `raw` по `seq` через `"\n"` — выгрузка в панели
  отдаёт файл байт в байт. Разбор может устареть без потерь: незнакомая строка становится `meta`, но хранится целиком.
- **Архив личный.** RLS пускает только владельца строки (и только пока он участник пространства), сервис ещё и фильтрует по
  `userId`: другой участник того же пространства не видит разговор даже по id. Агент пишет и читает от имени владельца токена.

## Импорт: дописывание без дублей

Пачка — строки файла с номера `fromSeq` (multipart, поле `lines`, каждая строка с `"\n"`; до 2000 строк и 8 МБ — укладывается
в 5-секундную транзакцию Prisma). Сервер под `FOR UPDATE` строки разговора сверяет перекрытие по sha256 и дописывает только
новое; `fromSeq` дальше конца — 409 `chat_archive_gap`, изменённая строка — 409 `chat_archive_diverged` (оба с `lineCount`).
Импортёр сначала спрашивает состояние (`import-state`; у хука — `hook/state`) (`lineCount`, `lastSha`), сверяет хеш той же строки своего файла и шлёт хвост.
Оборванная последняя строка (агент ещё пишет) не отправляется. Заголовок: `fallback` (первая реплика) < `auto` (ai-title
Claude Code) < `custom` (заданный в источнике) < `manual` (переименование в ORION — импорт его не трогает).

Три входа одного протокола:

| Кто | Маршрут | Лимит записей / журнал агента |
|---|---|---|
| Панель «Импорт файла» | `POST workspaces/:id/chat-archive/import` (JWT) | — |
| Хук `chat-archive-push.mjs` (в папке модуля) | `GET ai/v1/chat-archive/hook/state`, `POST …/hook/lines` (токен агента, `ChatArchiveHookController` — не инструмент MCP) | нет: хук срабатывает после каждого ответа |
| Инструмент `orion_chat_archive_import` | `POST ai/v1/chat-archive/import` (JSON, до 2 МБ) | да, как любая запись агента |

Хуку и инструменту нужно разрешение `chat-archive.conversation.create` (галочка инструмента импорта в подключении).
Агентам для чтения — `orion_chat_archive_search` / `_list` / `_read` (`chat-archive.conversation.read`).

## Хук Claude Code

`~/.claude/settings.json` → `hooks.Stop` и `hooks.SessionEnd`: `node <ORION>/apps/api/src/modules-ext/chat-archive/chat-archive-push.mjs --hook`. Скрипт берёт
`transcript_path` из события, токен — из `mcpServers.orion` в `~/.claude.json` (или `ORION_AGENT_TOKEN`), никогда не падает с
ошибкой (сбои — в `~/.orion/chat-archive-push.log`). Вся прошлая история: `node apps/api/src/modules-ext/chat-archive/chat-archive-push.mjs --all [--since 30]`.

## Ограничения (известные, осознанные)

- **Не входит в снапшот `.orion`** (`derived`): архив — сотни МБ, а снапшот собирается в памяти. Пока транскрипты лежат на
  диске, их можно импортировать заново; если исходники удалены (Claude Code чистит старые сессии), копия есть только в Postgres.
  Отдельная выгрузка архива в бэкап — следующий срез.
- **Cursor не поддержан**: его агенты хранят историю в SQLite (`state.vscdb`) с недокументированным и меняющимся форматом.
- Вложения (картинки) остаются base64 внутри `raw` и показываются пометкой «[изображение]».
- Поиск — `ILIKE` по репликам и ответам (без вызовов инструментов); на кластере с локалью `C` не складывает регистр кириллицы.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `chat-archive` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | — |
| Права (permissions) | `chat-archive.conversation.read`, `chat-archive.conversation.create`, `chat-archive.conversation.update`, `chat-archive.conversation.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `chat-archive` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/chat-archive` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | `20261020222504_chat_archive`, `20261028120000_chat_archive_auto_source` |
| Код на сервере | `apps/api/src/modules-ext/chat-archive/` |
| При выключении | Панель, API и инструменты агентов скрываются, хук получает отказ. Сохранённые разговоры остаются и вернутся при включении. |
<!-- generated:manifest:end -->
