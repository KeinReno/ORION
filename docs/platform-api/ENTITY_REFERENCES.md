# Перенос ссылок в транзакции

Публичный серверный контракт: `apps/api/src/common/entity-reference-registry.ts`, [ADR-0026](../adr/ADR-0026-transactional-reference-moves.md). Integration API — 1.1.0.

Владелец сущности после проверки прав и принадлежности записей вызывает EntityReferenceRegistry.moveTx в своей транзакции. Обработчики владельцев ссылок последовательно получают тот же Prisma transaction и `{workspaceId, entityType, fromIds, toId}`. Они обновляют только свои таблицы, ограничивают запрос workspaceId, не создают отдельных транзакций, не переключают RLS и не выполняют внешних действий. Ошибка откатывает команду целиком.

Первый сценарий: Contacts.merge → registry → CaptureReferenceMoves. Contacts больше не знает таблицу Capture; Captures обновляет собственные anchors. Без необязательных соседей registry может быть пустым. Полномочия и семантика merge остаются у инициатора; регистрация handler не даёт дополнительных прав.
