# Проверка ссылки на проект

Integration API 1.4.0 / Platform API 1.5.0; [ADR-0029](../adr/ADR-0029-project-reference-reader.md).
Публичные входы: apps/api/src/projects/public/project-references.ts и
apps/api/src/projects/public/project-references.module.ts.

Потребитель импортирует ProjectReferencesModule и получает ProjectReferences через Nest DI.
existsTx(tx, workspaceId, projectId) возвращает только boolean. Запрос находится в Projects,
выбирает только id, ограничен id/workspaceId и выполняется в исходной транзакции с её RLS.
Reader не открывает транзакции, не переключает роль и не выдаёт дополнительных прав.
Авторизация команды, null shortcuts, ошибки и политика включённости остаются у потребителя.

Потребители: Notes, Documents, Inventory, Inbox и Milestones. Отсутствующий/чужой проект
сохраняет прежний 404 «Проект не найден». Архивный проект допустим. При отключённом Projects
Notes/Documents/Inventory сохраняют прежнюю допустимость ссылки; Inbox проверяет включённость
Projects перед reader и даёт 409, а null остаётся допустимым без запроса. HTTP Milestones
закрывается guard Projects (409), его service проверяет лишь валидность ссылки.

SDK не импортирует ProjectsModule/ProjectsService и не запускает их controllers/cron.
Пять потребителей проверены в отдельной Nest-композиции с SDK и таблицей Project, без полного
ProjectsModule. Это не обещание удаления таблиц или независимости всех остальных модулей:
Goals и другие оставшиеся consumers мигрируются отдельно. Схема, UI и данные не меняются.

Контракт виден агентам через pnpm platform-map; декларация API не означает runtime permission.

Time и Calendar также используют ProjectReferences с Integration API 1.5.0 / Platform API 1.6.0;
[правила наследования и ICS](TASK_INTEGRATION_READER.md). Их ссылки на архивные/выключенные проекты
сохраняют прежнюю допустимость; авторизация и 404 остаются в потребителях.
