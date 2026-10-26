# Проекции задач для Time и Calendar

Integration API 1.5.0 / Platform API 1.6.0; [ADR-0030](../adr/ADR-0030-task-integration-reader.md).
Публичные входы Tasks: apps/api/src/tasks/public/task-integration-reader.ts и
apps/api/src/tasks/public/task-integration-reader.module.ts.

Потребитель импортирует TaskIntegrationReaderModule и получает TaskIntegrationReader через DI.
referenceTx(tx, workspaceId, taskId) возвращает только {id, projectId} либо null.
datedTx(tx, workspaceId) возвращает задачи со сроком, только поля ICS:
id, dueAt, status, projectTag, title, description. Возвращаемые даты — Date внутри сервера;
HTTP DTO задач и схема БД не меняются. Проекции не возвращают assignee, внутренние заметки
или произвольный Prisma model. Дополнительные поля требуют явного изменения контракта.

Запросы принадлежат Tasks (.service.ts под architecture-check), ограничены workspaceId,
исполняются в переданном tx/RLS без новой транзакции и смены роли. SDK не импортирует
TasksModule/TasksService и не запускает их controllers/cron. Наличие reader не выдаёт прав.

Time авторизует свою команду до reader, сохраняет 404 для чужой/отсутствующей задачи.
Проект наследуется от задачи, если явного projectId нет; явный проект имеет приоритет.
Привязки к выключенным Tasks/Projects сохраняют прежнее поведение. Очищение taskId и projectId
вместе не вызывает readers. Обнуление только projectId при сохранённой задаче снова наследует
её проект, как прежде. Project валидируется через ProjectReferences, а не прямым чтением.

Calendar вызывает datedTx в существующей asSystem-транзакции только после проверки feed token
и включённости Calendar/calendar-external. При выключенном Tasks reader не вызывается.
Reader не создаёт system-контекст и не проверяет секреты. UID, 15-минутная длительность,
описание, projectTag, отметка done и набор статусов ICS остаются у Calendar. Все существующие
статусы задач со сроком остаются в фиде; это не новый фильтр активных задач. Ссылка проекта
события проверяется ProjectReferences с прежними null/404 и допустимостью архива/отключения.

Отдельная Nest-композиция Time + Calendar проверяется без полных TasksModule/ProjectsModule,
при сохранённых SDK и таблицах. Физическое удаление таблиц, hot-install и независимость
остальных доменов не обещаются. Карта для агентов: pnpm platform-map (декларации не runtime grants).
