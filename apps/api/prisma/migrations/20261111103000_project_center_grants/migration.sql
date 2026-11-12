-- ЗАДАНИЕ 03: права ролей приложения на новые таблицы.
--
-- Остальные таблицы получают права из `infra/postgres/init/01-app-roles.sql`
-- (ALTER DEFAULT PRIVILEGES) — но это настройка КОНКРЕТНОЙ базы, созданной
-- init-скриптом. На чистой базе (CI, восстановление на новом узле) прав по
-- умолчанию нет, и приложение получило бы `permission denied`, хотя RLS уже
-- настроен. Явный GRANT в миграции повторяет прецедент
-- `20261101050000_development_catalog_mappings`.
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_templates", "project_history_entries" TO orion_app, orion_system;