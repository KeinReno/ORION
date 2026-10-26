# Связи Tasks с Projects и Milestones

Integration API 1.7.0 / Platform API 1.8.0; [ADR-0032](../adr/ADR-0032-task-planning-links.md).
ProjectTaskLinks / ProjectTaskLinksModule: projects/public/project-task-links{,.module}.ts.
MilestoneReferences / MilestoneReferencesModule: milestones/public/milestone-references{,.module}.ts.
Все пути относительно apps/api/src. SDK не импортируют полные доменные модули.

Tasks авторизует команду и передаёт исходный tx/RLS. byIdTx(tx, workspaceId, id) возвращает
{id,name} либо null; findOrCreateByNameTx(tx, workspaceId, name) ищет имя без учёта регистра и
при отсутствии создаёт проект. Trim и приоритет id над меткой остаются у Tasks; null/пустая
метка не вызывает создание. Существующая конкурентная семантика имён сохраняется, уникальность
при параллельном создании не вводится. Это команда, а не read-only API.

MilestoneReferences.findTx(tx, workspaceId, id) возвращает {projectId} либо null.
Tasks сохраняет 404 недоступной вехи/проекта и 400 при несовпадении проекта задачи и вехи.
Проверка относится к тому же workspace даже при доступе актёра к обоим. Архив/отключение
соседей сохраняют прежнюю семантику ссылок. Нет новой роли или транзакции; провал задачи
откатывает создание проекта. Запросы .service.ts принадлежат владельцам и проверяются архитектурой.

Отдельная композиция Tasks проверяется без ProjectsModule/MilestonesModule при сохранённых
SDK и таблицах. Не означает hot-install или физическое удаление схемы. UI/schema не меняются.
