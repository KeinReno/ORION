# Сквозная приёмка

## Среда и данные

Отдельная БД ORION acceptance, отдельный STORAGE_DIR, отдельный WebDAV stub/root, test sinks для уведомлений. Никаких реальных Telegram/ICS/почтовых side effects. Четыре fixture-пользователя: owner A, lead B, member C, outsider D. A и C дополнительно состоят во втором workspace для проверки смешения ссылок. Данные синтетические.

Базовый fixture: 2 workspace, 3 проекта, задачи с canceled/done/overdue/recurring/subtasks/dependencies, milestone chain, notes+revision+attachment, file+version+trash, finance transfer+split+budget+goal, inventory movements, habit entries, lists, адресные notifications и legacy time entries. Большой fixture отдельный, не замедляет каждый unit test.

Каждый сценарий записывает actual result, test path/название либо screenshot. «Проверено вручную» без шагов недостаточно.

## U01 · Личный день

1. Войти в личный workspace; создать мысль через Сегодня.
2. Разобрать в задачу со сроком; остаться в очереди.
3. Открыть задачу из Сегодня, запустить таймер, добавить заметку/связь.
4. Завершить задачу, остановить таймер, увидеть корректный итог.

Ожидание: один объект, ни одного лишнего перехода, scope не потерян, canceled не становится overdue. Проверить клавиатурой.

## U02 · Команда

A приглашает C, назначает задачу; C видит «Мои задачи», A и C запускают собственные таймеры. C не может остановить A. C получает уведомление, mark-read не меняет состояние A. Удаление C закрывает доступ и прекращает адресные доставки.

## U03 · Матрица доступа

A ограничивает finance/documents. Для C проверить:

- прямой CRUD и content/version content;
- search по уникальному названию/фрагменту;
- project list/detail/activity/totals;
- links обеих направленностей;
- note attachment list/download;
- notification content;
- backup/config/list/preview/apply/export;
- уже открытые панели и stale cache после изменения прав.

Ожидание: ни контент, ни сумма, ни имя запрещённого объекта не выдаются. A/B имеют только предусмотренные 08-TEAM права. Disabled и restricted различаются. D не видит workspace. Cross-workspace references для A/C отвергаются, хотя оба workspace доступны.

## U04 · Проект и план

Создать A→B→C milestones, задачи в них. Сдвинуть A, увидеть preview каскада и применить. Попытаться создать цикл, связать task с milestone другого проекта, параллельно изменить сроки второй сессией. Ожидание: детерминированные даты, полный rollback/409 при конфликте, нет частичного плана.

## U05 · Конфликт заметки

Два клиента читают revision N. Клиент A сохраняет A1; B отправляет B1 с N. Ожидание: B получает conflict, B1 сохранён как локальный draft, сервер A1 не затёрт. B может сохранить отдельную копию/осознанно согласовать. После reconnect и browser refresh draft восстанавливается только тому же user/workspace.

## U06 · Файлы

Upload mixed batch (valid/too large/unsupported), rename/move, conflict name, replace content с MIME change, restore version, trash/restore. Прервать storage operation между фазами. Ожидание: видимая partial failure, отсутствие silent overwrite, DB/blob consistency или видимый recoverable state.

## U07 · Полное восстановление

Снять backup fixture, изменить данные/удалить live blob, preview restore. Проверить counts/checksum/версии/вехи/склад/ссылки после применения. Запустить invalid manifest/missing blob/foreign workspace/stale preview/parallel restore случаи. Любой reject оставляет исходное состояние неизменным. Отдельный crash recovery test по журналу. Нельзя PASS только по количеству таблиц без проверки bytes.

## U08 · Большие данные и суммы

Создать 501+ time entries и >pageSize finance rows за период. Суммы сверить прямым эталонным расчётом fixture, не тем же helper, который тестируется. Переход страниц не меняет итог и не дублирует equal-timestamp rows. Разные валюты отдельно. Snapshot completeness и search access сохраняются на большом наборе.

## U09 · Границы времени

23:59→00:01 без перезагрузки; sleep до следующего дня; timezone change; DST boundary; all-day calendar event; habit отметка в UTC−11 и UTC+14. Ожидание: правильный local day, отсутствие пропущенных/двойных повторений, stable durations.

## U10 · Отказ сети/сессии

API недоступен до login; API пропал после ввода; 401 во время autosave; refresh из двух клиентов; timeout mutation; восстановление соединения; logout/login другой identity. Ожидание: ошибка не выглядит как empty, ввод не теряется, нет ложного saved, нет данных предыдущего аккаунта.

## U11 · Навигация

Поиск → закрытая lazy панель → точная сущность; тот же переход при открытой панели; повторный переход; back/forward; deleted entity; запрещённый target; смена workspace во время загрузки. Ожидание: intent применяется один раз правильному scope; не остаётся случайный старый selection.

## U12 · Интерфейс и accessibility

1280×800, 1440×900, narrow 390×844, reflow 320px; дополнительно узкая docked панель при широком viewport. Normal/compact, zoom 200%, reduced motion, разные accents. Keyboard: sidebar → list → detail → modal → close → возврат фокуса; DnD alternative; read-only state; icon accessible names. Контраст измерить. На 320px разрешена отдельная прокрутка таблицы/Ганта, не всей оболочки.

## U13 · Режимы запуска

Local loopback/account picker; server без directory/PIN; wrong secret repeated attempts; unexpected origin; startup missing secret; outbound redirect в private IP; oversized ICS. Ожидание: конкретный отказ/ограничение, отсутствуют секреты в логах.

## U14 · Concurrency

Настоящие одновременные запросы: два удаления последних owners; два запуска таймера одной identity; два расхода склада на остаток 1; два преобразования inbox; два cron tick для одного reminder/recurring payment. Ожидание: owner остаётся, таймер один, stock не отрицательный, targets/deliveries не дублируются.

## Выпуск

P0 сценарии доступа и восстановления обязательны. Не выполненные native tests ограничивают заявление только проверенным web build. К release приложить: версии, migration list, runbook, результаты команд, перечень ограничений, screenshots. Никакой автоматической отметки PASS по наличию тестового файла.

## Офисные документы · обязательное дополнение

Для выпуска офисного редактирования пройти OF01–OF10 из [21-OFFICE-IMPLEMENTATION](21-OFFICE-IMPLEMENTATION.md): DOCX и XLSX round-trip, права, идемпотентность/старые callback, сбой сохранения, два участника, история/backup, web/native, совместимость/нагрузка и эксплуатация. Приёмка базового просмотра документов не заменяет эту матрицу. Не выполненные в Word/Excel/Tauri проверки отмечать NOT RUN; зелёные mock/unit tests не подтверждают реальную интеграцию.

## Дополнение: связанное ядро и повторная офисная приёмка

UC01–UC10 определены в 24-CONNECTED-CORE-BACKLOG и обязательны для соответствующих U-срезов. OF02/O-приёмка уточнена 25-OFFICE-REVIEW: 4/4 новых regression tests пока FAIL; charts/pivot должны переживать recalculate и второй save, изображения/форматы не должны молча исчезать. Наличие кнопки и XML первого экспорта не заменяет видимый редактируемый результат. UI smoke выполнен только в web; Word/Excel/Tauri этой проверкой не подтверждены.
