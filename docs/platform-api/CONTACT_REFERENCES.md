# Проверка ссылки на контакт

Integration API 1.3.0 / Platform API 1.4.0; [ADR-0028](../adr/ADR-0028-contact-reference-reader.md).
Публичные входы Contacts: `apps/api/src/contacts/public/contact-references.ts` и
`apps/api/src/contacts/public/contact-references.module.ts`.

Сосед импортирует ContactReferencesModule и получает ContactReferences через Nest DI.
`existsTx(tx, workspaceId, contactId)` возвращает только boolean. Query принадлежит Contacts,
выполняется в переданной транзакции с её RLS-контекстом, ограничен id/workspaceId и выбирает только id.
Reader не открывает новую транзакцию, не переключает роль и не выдаёт права. Авторизацию команды
и ошибки своего API выполняет вызывающий модуль. Данные контакта наружу не передаются.

Первый потребитель — Health: доступ к человеку проверяется до проверки врача, недоступный контакт
даёт прежний HTTP 400, null очищает ссылку. Архив и выключенный Contacts не делают сохранённую
ссылку недопустимой. Это существующая политика; Contacts CRUD по-прежнему блокируется своим guard.

SDK-модуль не импортирует ContactsModule/ContactsService и не запускает controllers/cron.
Отсутствие полноценного ContactsModule проверяется в составе Nest при сохранённых SDK и таблице.
Удаление таблиц, произвольная hot-install и новые правила доступа этим контрактом не вводятся.
