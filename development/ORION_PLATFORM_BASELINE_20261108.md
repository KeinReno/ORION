# Состояние KAIDEN Orion на 8 ноября 2026

Снято с локального `master` после `git fetch`. `origin/master` — `d0931086` (описание замены беты 40). Локально сверху лежит непушенный `4c757faa` (общие меню на экранах ИИ и в настройках, установщик `0.1.42`). Контрольная точка из задания `5c6362c7` — предок, не текущий HEAD: после неё уже есть клавиатура меню и слежение за одним агентом (`2fcb1ff7`).

QA-v2 в этот репозиторий не входит и не сверялся как часть Orion. Сервер заметок ORION в сессии не подключён.

GitHub Actions на push в `master` ранее завершался за пару секунд без шагов и без раннера. Это ограничение запуска, не результат тестов. Локальный набор: `pnpm typecheck`, `lint`, `test`, `test:integration`, `architecture-check`, `plugin-contract-check`, `build`, `build:desktop-export`.

Открытые PR, которые не сливались: черновики QA #99–#107, README #97, XLSX #94, срезы Habitat #85–#91, Android #81 и #82. Кода Android в этом дереве нет.

| Компонент | Реализовано | Проверено | Не сделано | Причина | Приоритет |
|---|---|---|---|---|---|
| Модули и RLS | Каталог `MODULE_CATALOG`, `@RequireModule`, RLS на таблицах с `workspaceId` | Интеграционный структурный тест RLS существует; в этом цикле NOT_RUN | Новый модуль всё ещё требует правки нескольких слоёв по чек-листу в `CLAUDE.md` | Платформа уже модульная, но не пакетный marketplace | P1 |
| Расширения с диска | `apps/api/src/extensions/extensions.service.ts`, `apps/web/lib/extensions/runtime/loader.ts` | Код прочитан; e2e папки в этом цикле NOT_RUN | Публичный магазин и загрузка произвольного кода без подтверждения | Безопасность: только локальная папка и `extensions.json` | P1 |
| Агентские инструменты | `AGENT_TOOLS` = ядро + модули + `GENERATED_AGENT_TOOLS`; MCP `tools/list` в `apps/api/src/mcp/orion-mcp.ts`; генератор `scripts/module-registry.mjs` | Каталог и политика: тесты `agent-policy.test.ts` PASS в этом цикле | Клиент, закэшировавший старый список, не увидит инструмент до повторного `tools/list` | Отдельный реестр не нужен | P1 |
| Режимы агента | `decideAgentOperation` / `decideAgentModuleOperation` в `packages/shared-types/src/agent-policy.ts`. Admin не обходит членство (`AgentTokensService.authenticate`) | Юнит-тесты политики PASS | Запрет `documents` до этой правки не проверялся в `decideAgentModuleOperation` | Флаг был в UI, решение его игнорировало | P0 |
| Удаление агентом | Задачи, заметки, события; причина через `applyAgentDeleteReason`; аудит `AgentTokensService.record` | Код и прежние тесты; полный PostgreSQL в этом цикле NOT_RUN | Восстановление задачи нет: `TasksService.remove` делает `delete`. `QA-03-03` — `it.skip` | Удаление задачи задумано безвозвратным | P2, не менять без решения владельца |
| Присутствие | Память 2 минуты, опрос 2/6 с, слежение за одним токеном (`setFollowedAgent`) | `agent-presence.test.ts` PASS | Поле, diff в ленте, SSE, журнал переживающий рестарт | В событии нет имени поля; diff есть только у заявок (`agent-diff.ts`) | P1 |
| Agent Hub | Захват с CAS по `revision`, heartbeat, отмена человеком, `reconcileExpired` вручную | Исходники; интеграция QA-06 в этом цикле NOT_RUN | Нет cron примирения, нет dead-letter, `verify` не выставлен в HTTP, делегирование hub↔job отложено | Очередь уже есть, второй фреймворк не нужен | P1 |
| Гибридный sync | Списки, заметки, задачи. `decideOp`, `HybridSyncService` | Код `hybrid-sync.ts` / `sync-classification.ts`; fuzz-тесты в этом цикле NOT_RUN | Деньги, файлы, здоровье намеренно вне протокола | ADR-0016 / ADR-0012 | P1 |
| LAN | mDNS, TLS, отпечаток, код сопряжения, прокси `/_remote` | Код `apps/api/src/lan/`; живой второй ПК NOT_RUN | Отдельной передачи файлов в духе LocalSend нет | Не смешивать с sync и WebDAV | P1 |
| WebDAV | Зашифрованный снимок `.orion` и отдельно драйвер хранилища документов | Код; fault-injection в этом цикле NOT_RUN | — | Два разных механизма, оба нужны | — |
| DOCX | `columnSpan` / `rowSpan` в `docx-codec.ts` | Тест round-trip был зелёным в бете 38; в этом цикле NOT_RUN | Не весь Word | — | P1 |
| XLSX | `xlsx-codec.ts` и редактор в дереве | NOT_RUN | PR #94 не принимался как релиз; редактор не клон Excel | Не объявлять полным | P1 |
| Android | В репозитории нет `apps/android` | NOT_APPLICABLE | PR #81, #82 не слиты | Нет SDK в этой сессии, сборка не заявляется | P1 |
| Визуальные меню | `GlideSelect` / `Combobox` в `packages/ui/src/visual/fields.tsx` | `list-keyboard.test.ts` PASS. Мышь, модалки, узкий экран, живые финансы NOT_RUN | — | Клавиатура вынесена в `list-keyboard.ts` | P0 |
| Релизы | SHA-256 в теле релиза, версия NSIS обязана расти | Беты 38–40 опубликованы; CI NOT_RUN по сути (раннер не стартовал) | Локальный quality gate не заменяет приёмку профиля | — | P0 |
| Возможности / Compass / дневник питомца | Модули с API, UI и миграциями есть | NOT_RUN в этом цикле | Sync возможностей — стадия `later` | Не начинать новую волну | P2 |
