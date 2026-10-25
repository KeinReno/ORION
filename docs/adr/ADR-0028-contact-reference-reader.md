# ADR-0028: публичная проверка ссылки на контакт

Статус: принято для переноса Health → Contacts, 25.10.2026.

NEW_EXTENSION_POINT_REQUIRED: HealthService проверяет doctorContactId прямым чтением Contact.
Добавляется принадлежащий Contacts узкий серверный контракт `ContactReferences.existsTx(tx,
workspaceId, contactId): Promise<boolean>` и независимый `ContactReferencesModule` в `contacts/public/`.
Реализация запроса находится в `.service.ts` владельца Contacts и покрывается architecture-check.
Health импортирует только публичный контракт/модуль, не ContactsService и не ContactsModule.

Проверка выполняется в исходной транзакции вызывающего, без смены RLS и без новой транзакции.
Запрос ограничен id + workspaceId и выбирает только id; наружу возвращается boolean, не данные
контакта. Инициатор сначала проверяет права на медицинскую запись; сообщение и HTTP 400 для
недоступного контакта остаются у Health. Null очищает ссылку без обращения к reader.

Сохраняется существующая политика: архивный контакт и контакт выключенного модуля остаются
допустимой сохранённой ссылкой. Проверка ссылки не является Contacts CRUD и не требует включать
модуль. Contacts UI/API остаются за прежним guard. SDK-модуль не импортирует полноценный Contacts
и позволяет Health работать без его Nest-модуля; это не обещание удаления таблиц или hot-install.

Приёмка: create/update/null, чужой и удалённый контакт, архив/выключенный Contacts, RLS, отказ по
доступу к медицинским данным, работа Health при исключённом ContactsModule. Schema, UI, права и
данные не меняются; health.service.ts удаляется из списка исключений целиком.
Аддитивные версии: Integration API 1.3.0, Platform API 1.4.0; snapshot и capability map обновляются.
