# Captures — привязанные записи

Код: captures.service.ts / captures.controller.ts; типы в shared-types/anchored-capture.ts. Владелец таблицы Capture. REST workspaces/:workspaceId/captures проверяет членство и использует RLS; продвижение в задачу дополнительно требует доступного Tasks.

Перенос anchors при объединении сущностей регистрирует CaptureReferenceMoves через Core EntityReferenceRegistry. Запись выполняется в транзакции вызывающего и ограничена workspaceId; Contacts напрямую эту таблицу не меняет. Контракт: docs/platform-api/ENTITY_REFERENCES.md и ADR-0026.

Существующие обращения к соседним моделям в CapturesService — долг, перечисленный в scripts/module-boundary-exceptions.mjs. Этот этап его не расширяет.
