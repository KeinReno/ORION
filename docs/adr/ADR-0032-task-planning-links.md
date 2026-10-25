# ADR-0032: Tasks → Projects / Milestones

Статус: принято для контрольной точки Windows beta 22, 25.10.2026.
NEW_EXTENSION_POINT_REQUIRED: Tasks читает/создаёт Project и проверяет Milestone напрямую.
Projects предоставляет ProjectTaskLinks: byIdTx возвращает {id,name} либо null; findOrCreateByNameTx
ищет имя без учёта регистра и при отсутствии создаёт проект, возвращая {id,name}. Milestones
предоставляет MilestoneReferences.findTx с {projectId} либо null. SDK-модули независимы от полных
ProjectsModule/MilestonesModule; запросы .service.ts принадлежат владельцам и проверяются архитектурой.

Все методы используют переданный tx/RLS с workspaceId, без новой транзакции/смены роли.
Tasks сохраняет авторизацию, trim/null, приоритет projectId над projectTag, 404 и 400 чужой вехи,
привязку к тому же проекту, откат созданного проекта при ошибке задачи и прежнюю разрешённость
архивных/выключенных соседей. Поиск/создание по имени не получает новую гарантию уникальности:
существующая конкурентная семантика сохраняется. UI/schema/ownership не меняются.
Integration API 1.7.0 / Platform API 1.8.0. Исключение tasks.service.ts удаляется целиком.
Приёмка: create/update/case-insensitive reuse/id priority, RLS, foreign workspace, rollback,
пустые ссылки и Tasks без полных соседних Nest-модулей. Остальная арка переносится после beta 22.
