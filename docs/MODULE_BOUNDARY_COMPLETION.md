# Завершение межмодульных границ

Текущая работа по [ADR-0034](adr/ADR-0034-module-boundary-completion.md),
начата 26.10.2026 на 27bcb0e. Исходно 17 исключений; цель — ноль.

## Этап 1 — Goals: 17 → 16

ProjectCatalog сохраняет существующий расчёт прогресса и реестр агрегатов.
Task/Milestone проекции принадлежат владельцам, принимают исходный tx.
Проверка добавления проекта использует ProjectReferences. Goals больше не
импортирует полный ProjectsModule. Схема, UI и данные не менялись.

Проверено: API typecheck, focused ESLint, architecture-check, module-docs,
контрактный snapshot (2), plugin contracts (11), Goals integration (7).
Новый сценарий проверяет RLS, scope при доступе к двум пространствам,
видимость незакоммиченных данных и rollback. Финальные общие проверки ещё впереди.

## Этап 2 — Home Utilities: 16 → 15

HomeUtilityReferences проверяет активный дом и электрический счётчик в исходном tx.
404, привязка к дому, ограничения пространства и проверки плагина сохранены.
SDK не загружает HomeModule. Проверено: architecture-check, API typecheck,
focused ESLint, Home integration (7, включая коммуналку, тарифы, платежи и изоляцию).
