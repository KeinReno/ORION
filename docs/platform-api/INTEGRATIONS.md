# Integration API

## Как сейчас (v1.0, зафиксировано)

Единого Integration API нет; каждая интеграция — отдельный сервис внутри своего модуля со своим хранением настроек (аудит §2.11).

| Интеграция | Где | Направление |
|---|---|---|
| Календарные ICS-фиды | `apps/api/src/events/calendar-connections.service.ts` (cron раз в 30 минут), `calendar-connections.controller.ts` | входящие |
| Исходящий ICS-фид по токену | `apps/api/src/events/calendar-feed.controller.ts` (`GET calendar/:token.ics`) | исходящий |
| WebDAV (файлы и синхронизация) | `apps/api/src/storage/webdav.storage.ts`, `apps/api/src/sync/webdav-remote.ts`; секреты — `sync/sync-crypto.ts` | двусторонний |
| Telegram | `apps/api/src/notifications/telegram.service.ts` (без токена — dry-run) | исходящий |
| Compass-движок (Рынки) | `apps/api/src/markets/compass-engine.service.ts`, прокси `…/markets/engine/api/*`; Python в `apps/compass-engine/`; только `ORION_MODE=local` | локальный процесс |
| HH-импорт и исполнение | `apps/api/src/opportunities-hh-import/`, `opportunities-execution/`, `scripts/hh-runner` | входящий |
| LAN-узлы | `apps/api/src/lan/` (ADR-0015) | узел и узел |
| Агенты (MCP/HTTP) | [AGENT_GATEWAY.md](AGENT_GATEWAY.md) | входящий |

**Общее, что уже есть:** SSRF-заслон `apps/api/src/common/remote-url-guard.ts` (`assertPublicRemoteUrl` при сохранении,
`fetchPublicText` / `publicOnlyAgents()` при запросе; DNS проверяется в момент соединения, редиректы не следуются, тело ≤ 5 МиБ).
Любой пользовательский URL обязан идти через него, голый `fetch()` запрещён (CLAUDE.md). Продюсеры уведомлений
интеграций спрашивают `NotificationPolicyService`.

## Контракт v1.0 как есть

Только соглашения: SSRF-заслон, шифрование секретов синхронизации, гейтинг модулем и `ORION_MODE`. Интерфейса, реестра
интеграций, статуса подключения и учёта их разрешений нет.

## Целевое состояние

Интеграция — компонент (плагин) с манифестом: объявляет внешние адреса и права, хранит секреты через общее хранилище, использует
общий исходящий клиент (SSRF, лимиты, таймауты), публикует статус для менеджера компонентов; входящие данные попадают в систему
через события и capture, а не прямыми записями в чужие таблицы. Конкретная форма не выбрана — требуется ADR.

## Не сделано

Всё из «Целевого состояния»; реестр интеграций; общее хранилище секретов (сейчас только `sync-crypto.ts`); перенос данных
Compass в Postgres или включение в бэкап (G22). В карте пробелов аудита отдельной строки для Integration API нет (только §2.11).
