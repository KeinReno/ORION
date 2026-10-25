# ADR-0029: публичная проверка ссылки на проект

Статус: принято для переноса Notes/Documents/Inbox/Inventory/Milestones → Projects, 25.10.2026.

NEW_EXTENSION_POINT_REQUIRED: пять потребителей проверяют Project напрямую.
Добавляется принадлежащий Projects контракт ProjectReferences.existsTx(tx, workspaceId,
projectId): Promise<boolean> и отдельный ProjectReferencesModule в projects/public.
Запрос остаётся в Projects .service.ts, проверяется architecture-check, выбирает только id
с явным workspaceId и использует исходную транзакцию/RLS. Новых прав и транзакций нет.

Потребители сохраняют собственную авторизацию, null shortcuts и прежний NotFound 404.
Inbox продолжает проверять включённость Projects до reader; остальные сохраняют прежнюю
допустимость архивных/выключенных проектов. Контракт не определяет продуктовую политику.
SDK не импортирует ProjectsModule/ProjectsService, не запускает контроллеры или фоновые задачи.
Схема, UI, данные и ownership не меняются. Остальные более богатые обращения к Project
остаются отдельным долгом; физическое удаление таблицы и hot-install не обещаются.

Integration API 1.4.0 / Platform API 1.5.0. Проверки: пять потребителей через HTTP,
посторонний и доступный чужой workspace, отсутствующий id, архив/выключение, rollback,
RLS и видимость незакоммиченных данных; SDK composition без ProjectsModule.
