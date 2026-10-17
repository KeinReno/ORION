# Шаблоны поручений ИИ-разработчику ORION

Заготовки для Cursor/Grok/Claude и других инструментов. Каждый исполнитель читает `AGENTS.md`, `ORION_CONSTITUTION.md`, `01_DEVELOPMENT_AGENT_PLAYBOOK.md` и существующий passport выбранного домена. **Шаблоны не дают полномочий обходить текущую архитектуру и права.**

## 1. SPEC — задача до кода

```md
# ORION SPEC: <slug> / <date>

Статус: PROPOSED / APPROVED / IMPLEMENTING / QA / ACCEPTED
Владелец продукта:
Агент / рабочая копия / baseline commit SHA / git status:
Другие активные агенты и владельцы файлов:

## Пользовательский смысл
Проблема:
Кому и в каком workspace:
Вертикальный сценарий (вход → действие → результат):
Чего принципиально НЕ делаем:

## Классификация и архитектура
Core / Base Module / Plugin / Bridge:
Как это закреплено в AI_REFACTOR_MIGRATION_MAP:
Новый ADR / Extension Proposal:
Существующий аналог в ORION и отличие:
Public API / SDK / typed slots:
Manifest, dependants, capability flags, defaultEnabled:

## Владение и данные
Owns / Does not own:
Запланированные изменяемые файлы:
Общие файлы, требующие координации:
Права/роли + workspace и user ACL:
DTO/event/API версии:
Schema / migrations / RLS / snapshot / backups / imports:
Sync mode, CAS/conflicts, idempotency:
Retention, archive, disabled, purge:
External URL/files/secrets/consent/threat model:

## UI
Встроенная панель или typed slot:
Empty/loading/error/denied/offline/disabled/conflict:
Keyboard, 320/390/desktop, темы:
Состояние черновика, навигация, смена пространства:

## Тесты и сдача
Unit:
Integration: separate test PostgreSQL / RLS / restore:
E2E / visual / native if applicable:
default-full и plugins-off:
Failure injection / rollback:
Что значит DONE:
Необходимое решение пользователя:
```

## 2. Набор негативных тест-кейсов, который агент должен адаптировать

```md
- Workspace A: user A читает/пишет свой ресурс — ALLOW.
- Workspace B: user A пытается прочитать/изменить ресурс B по ID — DENY, без утечки метаданных.
- Restricted member / revoked grant — DENY без client-only защиты.
- Module disabled, plugin disabled — нет ошибки Base; история остаётся и не удаляется.
- Plugin enable again — прежние настройки/записи восстановимы.
- Stale revision / concurrent writes — 409/CAS/прогнозируемый merge, без тихой потери.
- Invalid file/url/oversized payload/redirect to private host — безопасный отказ.
- Import repeated — no duplicate/side effects; preview не изменяет объекты.
- Backup → clean DB restore — точность данных, вложения, права, отношения.
- Offline/unavailable external service — корректная деградация и retry policy.
- Theme switch / workspace switch / keyboard / mobile 320 и 390 — работает.
- Production build / desktop export и Tauri smoke, если относится к задаче.
```

## 3. Отчёт/HANDOFF после изменения

```md
# ORION HANDOFF: <slug>
Исходный SHA и итоговый SHA (если коммит разрешён):
Режим: shared Cursor tree / отдельная изолированная копия:
Владеемые файлы, изменённые файлы (полный перечень):
Какие общие файлы согласованы:
Факт функциональной реализации:
Какие сценарии пройдены вручную:
Тест — точная команда / exit code / passed / failed / skipped:
E2E/visual/screenshots — реальные пути, проверенные размеры:
Security/RLS: положительные и отрицательные сценарии:
Snapshot/restore, disabled, upgrade:
Непроверенные области (не выдавать за успех):
BLOCKED: путь/контракт/минимальный diff/ответственный:
Известные дефекты, риск данных и rollback:
Следующий безопасный шаг:
Статус: READY FOR REVIEW / PARTIAL / BLOCKED / ACCEPTED BY OWNER
```

## 4. Стартовая инструкция агенту — копировать

> Ты ИИ-разработчик ORION. Сначала прочитай `AGENTS.md`, `ORION_CONSTITUTION.md`, `docs/AI_REFACTOR_MIGRATION_MAP.md`, `docs/MODULES_AND_PLUGINS.md`, `docs/AI_FIRST_EXTENSION_ARCHITECTURE.md` и `docs/PLATFORM_EXPANSION_2026-10-17/01_DEVELOPMENT_AGENT_PLAYBOOK.md`. Изучи актуальный STATUS, паспорт целевого модуля и реальные public contracts. До кода подготовь SPEC по шаблону, классифицируй Core/Module/Plugin/Bridge согласно карте и назови владельца файлов. Не меняй shared-файлы, если рядом работают другие агенты; пропущенный extension point оформляй как NEW_EXTENSION_POINT_REQUIRED. Реализуй только согласованный вертикальный срез; сделай доступные targeted tests, затем через координатора общие gates на изолированной БД. Не стирай данные, не обходи ACL/RLS, не выполняй внешние необратимые операции без разрешения. В конце сдай HANDOFF с точными доказательствами, включая незапущенные тесты и блокировки. Не обещай готовность без приёмки.

## 5. Стартовая команда для будущего Pet Care

> Прочитай обязательные архитектурные документы и `docs/PLATFORM_EXPANSION_2026-10-17/04_PET_CARE_CONCEPT.md`. Выполни только **M0: документальная проверка текущего HEAD, ADR, permission matrix, entity/DTO draft и UX user flows**, без Prisma миграций и без изменения продакшен-кода. Подтверди, что Pet Care — самостоятельный optional module, и продумай bridges к Documents/Calendar/Notifications без дублирования Human Health. Предоставь решение по спорным пунктам для владельца, план M1 и отчёт по шаблону. Не заявляй, что пустой GitHub `Murchik_HP` содержит пригодный для переноса код.
