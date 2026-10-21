# Подготовка LAN и границы первой alpha

## Существующий контракт
Источник: shared-types/src/lan.ts, hybrid-sync.ts; core/src/sync;
api/src/sync/hybrid-sync.controller.ts; ADR-0015 и ADR-0016.
LAN protocol=1; порт по умолчанию 4443, TLS fingerprint, pairing nonce,
одноразовая выдача device token. Sync protocol=1; UUID opId/deviceId/entityId,
монотонный deviceSeq и HLC. Операции create/patch/delete; разрешённые поля
валидируются общим syncOpSchema. Tasks/Notes уже входят в writable entities.

API: POST sync/devices; GET workspaces/:id/sync/replica;
GET .../replica/changes?cursor=...; POST .../ops.
Вход пользователя, членство, включённые модули и права остаются серверными.
Для заметок patch требует expectedRevision; Android сохраняет базовую ревизию
с учётом своих предшествующих правок, не заменяет конфликт last-write-wins.

## Alpha
Сохраняет локальные записи и операции в одной транзакции, неизменные UUID,
HLC и sequence переживают перезапуск. LAN-экран сохраняет адрес/порт как
профиль подготовки. Это не pairing, не проверка доступности и не подключение.
Синхронизация не выполняет сетевых вызовов, не отправляет токены и не
обходит TLS. Начиная с alpha.2 отдельный updater обращается к публичному
источнику версий; он не передаёт задачи, заметки и другие локальные данные.

## Следующий срез
1. Нативный Android TLS transport: чтение реального peer certificate,
   подтверждение fingerprint/code на ПК, pinning при каждом запросе.
   Запрещены trust-all, cleartext, доверие только node card и JS-заглушки TLS.
2. Android Keystore для device token/refresh token, без логирования секретов.
3. Вход через разрешённый LAN API, выбор workspace из ответа сервера.
4. Регистрация sync device; отдельное хранилище по node + user + workspace.
5. Пустая replica из настоящего snapshot, затем existing ReplicaEngine +
   apiSyncTransport; таймауты, idempotent retries, paged pull.
6. Явный импорт локальных записей в выбранное пространство с новыми
   операциями; не переносить local deviceSeq в уже зарегистрированное устройство.
7. UI конфликтов и проверка политики стирания remote cache при revoke:
   локальное независимое пространство не затрагивается.

## Матрица проверки
Потерянный ответ push; повтор opId; закрытие во время записи; откат часов;
два устройства меняют заметку; 401/403/revoke; модуль выключен; истёкший cursor;
несовместимый protocol; подменённый сертификат; смена пользователя;
недостаток места; ColorOS выгружает процесс. Нужны проверки на реальном
OPPO Reno8 5G и ПК в одной LAN, отдельно от mock-тестов.
