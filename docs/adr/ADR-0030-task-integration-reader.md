# ADR-0030: чтение задач для Time и Calendar

Статус: принято для переноса границ Time/Calendar, 25.10.2026.

NEW_EXTENSION_POINT_REQUIRED: Time читает Task для ссылки и наследования projectId,
Calendar читает сроки Task для исходящего ICS. Добавляется Tasks-owned TaskIntegrationReader
в tasks/public с двумя read-only методами: referenceTx(tx, workspaceId, taskId) возвращает
{id, projectId} либо null; datedTx(tx, workspaceId) возвращает только поля ICS (id, dueAt,
status, projectTag, title, description). Реализация .service.ts остаётся под architecture-check.
Отдельный SDK module не импортирует TasksModule/TasksService.

Оба запроса ограничены workspaceId, используют переданный tx без смены роли и новой транзакции.
Проверки прав и ошибок остаются у потребителей. Calendar вызывает datedTx только после проверки
секретного feed token, выключенного Calendar/calendar-external и Tasks. Существующий asSystem
контекст принадлежит исходящему feed, reader не выдаёт эту роль самостоятельно.
Time сохраняет разрешённость существующих ссылок при выключенных соседях, null, 404 и приоритет
явного проекта над проектом задачи. Для Project Time и Calendar используют уже принятый
ProjectReferences (ADR-0029). Календарный формат, выбор статусов и задачи без сроков не меняются.

Удаляются две полные записи exceptions (Time и Events), без нового исключения. Schema, UI,
ownership и данные не меняются. Integration API 1.5.0 / Platform API 1.6.0. Проверки: RLS,
workspace scope даже при доступе к обоим, транзакционная видимость/rollback, timer/manual/update,
ICS token/rotation и отключение соседей; состав SDK без полных TasksModule/ProjectsModule.
