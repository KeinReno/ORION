# Матрица незавершённого, 8 ноября 2026

Статусы: DONE, PARTIAL, NOT_STARTED, BLOCKED, NOT_APPLICABLE. QA-v2 не является задачей Orion.

| ID | Направление | Проблема | Приоритет | Файлы | Зависимости | Статус |
|---|---|---|---|---|---|---|
| P0-UI-01 | Клавиатура GlideSelect | Стрелки, Enter, пробел, Escape, Tab, фокус, клик снаружи, буква | P0 | `packages/ui/src/visual/fields.tsx`, `list-keyboard.ts` | Формы задач, целей, счетов | DONE. Юнит-тест клавиш PASS. Мышь и модалка NOT_RUN |
| P0-UI-02 | Клавиатура Combobox | Стрелки, Enter, Escape, Tab. Пробел остаётся поиском | P0 | те же файлы; `transaction-form.tsx`, `task-form.tsx` | `onChange` формы | DONE на уровне клавиш. Живое сохранение операции NOT_RUN |
| P0-POL-01 | Запрет «документы» | Флаг `documents` не влиял на `decideAgentModuleOperation`, в том числе для admin | P0 | `packages/shared-types/src/agent-policy.ts` | Инструменты `documents.document.*` | DONE в этом цикле, тест PASS |
| P0-REL-01 | GitHub Actions | Job `quality` падает за секунды без шагов | P0 | `.github/workflows/ci.yml` | Биллинг или раннер аккаунта | BLOCKED. Тесты не переписывать. Локальные команды перечислены в baseline |
| P0-REL-02 | NSIS | Повтор той же версии не обновляет установленную копию | P0 | `apps/desktop/src-tauri/Cargo.toml`, `tauri.conf.json` | Каждый новый установщик | DONE как правило. Сейчас в дереве `0.1.42`, на GitHub у беты 40 файл `0.1.41` |
| P1-AG-01 | Каталог возможностей | Не заводить второй реестр. Уже есть `AGENT_TOOLS` и `module-registry.mjs` | P1 | `agent-tools.ts`, `orion-mcp.ts` | Манифест модуля | PARTIAL. Новый инструмент виден после генерации и рестарта API |
| P1-AG-02 | Восстановление задачи агентом | Жёсткое удаление | P1 | `TasksService.remove` | Решение владельца | NOT_STARTED. Не делать без явного решения |
| P1-PR-01 | Поле и diff в присутствии | Событие не несёт имя поля и пару было/стало | P1 | `agent-presence.service.ts`, `agent.ts` `agentPresenceEventSchema` | Заявки уже имеют diff | NOT_STARTED |
| P1-PR-02 | Слежение за одним агентом | Общий режим открывал последнее событие любого агента | P1 | `agent-presence.tsx` `navigationTarget` | — | DONE. Кнопка «Следить» у имени |
| P1-PR-03 | Журнал для воспроизведения | Лента живёт 2 минуты в памяти процесса | P1 | `AgentPresenceService` | Аудит `agentAuditEntry` уже пишется | NOT_STARTED. Не анимировать то, чего не было |
| P1-PR-04 | SSE вместо опроса | Опрос 2/6 с | P1 | `use-agent-tokens.ts` | Идентификаторы событий уже есть | NOT_STARTED |
| P1-HUB-01 | Примирение lease | `reconcileExpired` только по POST, без cron | P1 | `agent-hub-worker.service.ts` | CAS по revision уже есть | NOT_STARTED |
| P1-HUB-02 | Приёмка исполнения | `verify` есть в чистой функции, нет в HTTP `report` | P1 | `agent-hub-lifecycle.ts` | Не копировать QA-v2 | NOT_STARTED |
| P1-HUB-03 | Делегирование hub | Мост к AgentJob отложен | P1 | `modules-ext/agent-hub` | `orion_create_job` уже есть отдельно | NOT_STARTED |
| P1-SYNC-01 | Sync кроме трёх сущностей | Деньги, файлы, здоровье вне протокола намеренно | P1 | `sync-classification.ts` | Не смешивать с LAN и WebDAV | NOT_STARTED для новых сущностей |
| P1-LAN-01 | Передача файлов в LAN | Есть обнаружение и доверие, нет отдельного протокола файлов | P1 | `apps/api/src/lan/` | Не копировать LocalSend | NOT_STARTED |
| P1-AND-01 | Android | PR #81, #82 не в этом дереве | P1 | нет `apps/android` | Контракты Windows beta 40 | BLOCKED. SDK в сессии нет, сборка не заявляется |
| P1-XLSX-01 | Таблицы | Редактор в дереве, PR #94 не был релизом | P1 | `xlsx-codec.ts`, `xlsx-editor.tsx` | documents-office | PARTIAL. Round-trip всех конструкций Excel NOT_RUN |
| P2-OPP-01 | Возможности | Модуль есть, sync `later`, внешние отклики не трогать | P2 | `apps/api/src/opportunities/` | — | PARTIAL |
| P2-MKT-01 | Compass | Движок и вкладки есть, журнал в SQLite движка | P2 | `apps/api/src/markets/` | Не второй учёт денег | PARTIAL |
| P2-PET-01 | Дневник питомца | Модуль подключён | P2 | `modules-ext/pet-care` | — | PARTIAL, приёмка NOT_RUN |
