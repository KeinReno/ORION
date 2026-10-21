# Android: центр настроек

Статус **PROPOSED**, 21.10.2026. Архитектура: [FRONTEND_ARCHITECTURE](FRONTEND_ARCHITECTURE.md).
Это структура будущих страниц, не список уже работающих переключателей.
Сегодня settings.tsx содержит appearance/depth/update/export, остальные группы
показывать только по мере появления работающих capabilities.

## 1. Brief и принцип области действия

Задача: найти параметр по смыслу, понять последствия, изменить его без потери
записей и не искать по бесконечной странице. Действующие лица: локальный владелец,
участник remote workspace, owner/lead пространства. Последствие: личная настройка
не меняет команду; командная требует серверных прав; device preference не становится
аккаунтной только из-за одинакового названия. Успех: прямой поиск «наклон», «дата»,
«копия» открывает конкретное поле, а не верх длинного экрана.

| Scope | Подпись в UI | Примеры | Сейчас |
|---|---|---|---|
| device | На этом телефоне | эффект, загрузка APK, доступ к Android permissions | MobileSettings |
| personal | Только для вас, на поддерживаемых устройствах | account defaults, язык/форматы после public prefs API | Не заявлять sync без adapter |
| workspace | Для участников «Название» | modules policy, общие категории/права | Серверная операция по public API, не локальный switch |
| workspace-personal | Только для вас в «Название» | сохранённый фильтр, любимый вид | Scope-specific storage, не общая конфигурация |
| info | Сведения | версия, лицензии, состояние | Ничего не сохраняет |

Ни одна страница не смешивает scopes без явных подзаголовков. Сейчас theme/depth
и update toggles device-only, даже если desktop appearance относится к personal.
Будущее «Как в моём профиле» допустимо только после shared preference adapter;
локальное переопределение не отсылается всем. Эффекты/доступность телефона всегда
могут уменьшить движение; OS reduced motion не обходится. Нет общего магического
порядка override для всех полей: precedence задаётся конкретным field contract.
rule/name-object-scope-consequence, rule/preserve-mental-model.

## 2. Главная страница

Header: Назад, «Настройки». Затем scope chip и строка поиска «Найти настройку».
Сверху максимум один полезный status: доступен APK / не сохранено / конфликт.
Не превращать hub в dashboard из десятка одинаковых карточек и анимаций.
Группа — подпись, внутри list rows: иконка, название, текущее короткое значение,
chevron. Строка ведёт на страницу; toggle в ней допустим только для одной
самостоятельной операции, не вместо перехода к сложному разделу.

```text
Настройки                         [Поиск]
На этом телефоне
  Внешний вид                     Precision, системная
  Движение и жесты                Наклон 60%
  Голос и ввод                    Системная диктовка
  Подключение и синхронизация      Компьютер / офлайн
  Данные и резервные копии         Последний экспорт
  Обновления                      0.1.x, актуально
Ваш профиль                       [только при подключённом аккаунте]
  Профиль и безопасность
  Уведомления
  Язык, дата и время
Пространство «Работа»              [только в remote контексте]
  Общее и участники
  Модули и расширения
  Настройки модулей
Справка
  Возможности и разрешения телефона
  Диагностика
  О приложении
```

Группы могут быть длиннее viewport: это один понятный список, не все формы сразу.
В первом выпуске нового hub использовать только существующие разделы, а не серые
страницы-заглушки. «Скоро» допустимо в отдельном обзоре возможностей, не рабочем menu.
rule/structure-before-containers, rule/inline-before-modal, rule/smallest-intervention.

## 3. Каталог страниц

### Внешний вид — device сейчас
Сверху живой компактный preview одного и того же содержимого. Режим Системная /
Светлая / Тёмная — segmented control; palettes — список swatches с названием и
выбранным состоянием, не только цветом. Precision/Obsidian/Midnight/Emerald/Crimson,
Arctic в light сохраняются. Плотность и размер текста вводить только после
адаптивных компонентов; пользовательский масштаб не должен уменьшать targets.
Фон/контраст не отдельный цвет на каждый экран. Сброс только этой группы, не записей.
rule/control-matches-cardinality, rule/accessible-name-required.

### Движение и жесты — device
Сначала смысловые группы «Анимации», «Глубина», «Быстрые действия».
Глубина: switch, сила 0–100% с числом и подписями «Слабее / Сильнее», preview,
состояние датчика, объяснение паузы. Сохранение slider после отпускания; preview
может меняться во время drag без постоянных disk writes. Максимум должен быть
видимым на OPPO; угол и чувствительность — детали реализации, не два обязательных
ползунка. Не маскировать ошибку датчика увеличением числа выше 100.
Физические слои: chrome base, whole content card, overlay; текст внутри card плоский.
Калибровка/инверсия — только если аппаратная приёмка докажет необходимость,
не набор настроек вместо исправления направления. OS запрет анимаций объясняется.
Жесты: короткая демонстрация hold/slide, кнопочная альтернатива, task drag handle.
Настраивать чувствительность каждого жеста до доказанной потребности не требуется.
rule/smallest-intervention, rule/keyboard-complete-flow, rule/cover-reachable-states.

### Голос и ввод — device
Текущее: запуск системной диктовки, результат добавляется в выбранное поле draft.
Показывать availability provider, зависимость от системного языка/интернета и кнопку
проверки. Запрет/отмена сохраняют обычный ввод. Не обещать offline recognition.
Будущее audio capture отдельно от диктовки: формат, лимиты, private files, playback,
interruption и backup. Пока pipeline не готов, не показывать «Записывать аудио» switch.
Внешний provider управляет своим consent; Orion не обещает его локальность.
rule/permission-benefit-first, rule/preserve-user-input.

### Подключение и синхронизация — device + выбранная replica, подписи отдельно
Подключённый компьютер, имя узла, pairing/TLS состояние, выбранный аккаунт и
workspace, последнее подтверждение обмена, pending/conflicts. Адрес/port — в
«Параметры подключения», не первая страница для уже подключённого пользователя.
Действия: подключить, проверить соединение, синхронизировать, открыть очередь,
разобрать конфликты. «Найден компьютер», «Выполнен вход» и «Есть копия» различаются.
Список поддерживаемых данных показывает task/note отдельно от local finance.
Не показывать рабочий auto/background sync toggle, пока worker/lifecycle не готов.
Отключить соединение ≠ удалить replica. Перед удалением копии показать scope,
pending/drafts и возможность экспорта; не стирать очередь молча.
rule/name-object-scope-consequence, rule/error-states-recovery.

### Данные и резервные копии — device, scopes раздельно
Секции «Записи на телефоне», «Копии пространств», «Файлы», «Экспорт».
Счётчики только реально измеренные; не выдавать размер JSON за полный размер app.
Текущее действие — экспорт portable content JSON через Android file picker.
Явно написать, какие данные попали, что settings/secrets/media могут не входить.
Не называть экспорт синхронизацией или полным восстановимым образом телефона.
Будущий restore: выбор → validation/version → dry preview количества и конфликтов →
выбор target scope → import/replace отдельно → проверка → итог. Идентичность нового
устройства новая, old deviceSeq не воспроизводится. До этой реализации restore не
должен выглядеть доступным. «Очистить кэш» не затрагивает drafts/outbox/local finance.
Destructive действия в отдельном блоке с полным именем scope и последствиями.
rule/destructive-proportional, rule/preserve-user-input, rule/no-confirm-ok-labels.

### Обновления — device
Версия/code/channel, последняя проверка, кнопка проверки; при доступном APK — notes,
размер и скачать/установить. Auto check и Wi-Fi download существующие независимые
switches. Сохранить фиксированный approved release feed, digest/package/cert checks.
Нет ввода GitHub token или произвольного URL в обычном UI. Android подтверждает
установку. Не писать «актуально» после ошибки последней проверки без даты успешной.
Permission install, отмена, частичная загрузка, несовпадение подписи — отдельные
состояния; несовместимый APK не предлагается установить.
rule/cover-reachable-states, rule/success-state-specific.

### Профиль и безопасность — personal / device разделены
Профиль remote identity, имя и доступные account actions после публичного адаптера.
Показать «Подключён к этому компьютеру» вместо выдуманной облачной регистрации.
Сессии/пароль — по поддержанному API и роли; не создавать local-only смену пароля.
Блокировка приложения/биометрия — отдельная device capability с recovery, без
имитации защиты CSS overlay. Выход из account объясняет доступ к копии, drafts и
неотправленные изменения; не удаляет phone записи. Нет облачного входа по умолчанию.
rule/name-object-scope-consequence, rule/value-before-interruption.

### Уведомления — personal правила + device delivery
Типы событий показывают владельца модуля; тихие часы и контент lock-screen отдельно.
Запрошено приложением, разрешено Android, доставляется системой — разные факты.
Недоступная provider capability не создаёт мёртвый switch. Permission при первом
нужном reminder; отказ оставляет app пригодным. При revoked module права доставки
пересчитываются, не продолжаются сообщения о недоступных данных.
rule/cover-reachable-states и rule/permission-benefit-first.

### Язык, дата и время — device сейчас / personal после API
Следовать системе по умолчанию; preview даты, времени и суммы. Начало недели и
часовой пояс разделены с timezone конкретного события. Даты операций «сегодня»
считаются по рабочему localDate на момент действия/resume; явно выбранная дата не
меняется. Формат валюты не конвертирует суммы и не добавляет мультивалютную модель.
rule/name-object-scope-consequence, rule/preserve-mental-model.

### Пространство: общее и участники — workspace
Имя/контекст, участники и роли, ограничения модулей, доступные приглашения.
Показывать только серверные полномочия; обычному участнику — readable status и
путь обращения к owner. Изменения shared policy не выдавать за настройку телефона.
При отзыве прав открытый экран пересчитывается; offline cache не раскрывает свежие
данные после revocation. Местные view preferences не меняют коллегам списки.
rule/name-object-scope-consequence, rule/cover-reachable-states.

### Модули и расширения — workspace policy и personal navigation раздельно
Карточка: название, короткая задача, mobile support, enabled policy, доступные действия.
«Закрепить внизу», «Скрыть у меня», «Отключить в пространстве» — разные команды.
Включённый на ПК модуль без mobile renderer не объявлять выключенным/неустановленным.
Отключение сохраняет данные и настройки; повторное включение восстанавливает вклад.
Новые APK могут добавлять bundled contributions; произвольный desktop plugin/JS не
скачивается в WebView. Расширения из папки desktop не равны Capacitor plugins.
rule/name-object-scope-consequence, rule/preserve-mental-model.

### Настройки модулей — scope по каждому полю
Одинаковый путь из hub и из меню модуля, одна registry запись/один field ID.
Примеры: Tasks — local sort/view и видимые поля; Notes — вид excerpt/editor defaults;
Finance — счёт по умолчанию и управление категориями (разные scopes!). Общее
редактирование категорий — domain screen, не бесконечная форма app settings.
Существующие Finance categories пока не редактируются через settings — это будущее.
Докладная матрица всех модулей: [MODULE_SURFACES](MODULE_SURFACES.md).
rule/structure-before-containers, rule/inline-before-modal.

### Возможности телефона, диагностика, о приложении — device/info
Permissions: текущее состояние и объяснение нужного сценария, переход в Android
settings где возможно; нет запроса «разрешить всё». Датчик — реальные native samples,
microphone/provider — проверка, install permission — отдельная capability.
Диагностика: версия, storage/sync health, последние обезличенные ошибки, retry.
Экспорт отчёта только явным действием, preview/redaction: ни токенов, ни финансового
текста, ни заметок в автоматическом telemetry. Diagnostics не рабочая первая страница.
About: версия, источник APK, лицензии, краткое обучение, доступные контакты проекта.
rule/permission-benefit-first, rule/cover-reachable-states.

## 4. Field contract и сохранение

Одна запись field: стабильный id (`device.motion.depthStrength`), pageId, owner,
scope, label, keywords, control, schema/default, read/patch port, availability,
search anchor, reset policy и source/effective value. Typed catalog производит menu,
поиск и страницу; компонент без записи не появляется скрытым параметром вне поиска.
Расширения подчиняются тем же правилам и попадают в search index.

Переключатель — немедленная узкая запись; multi-field form — один explicit Save.
Slider preview transient → commit release. Ошибка: значение/форма сохранены в UI как
неприменённые, рядом retry; success только после durable ack. Текущее saveSettings
заменяет весь object: до роста каталога нужен patch(field,value), merge внутри
сериализованной transaction, а не stale spread соседнего React render.
Сброс: поле/раздел с названной областью, без глобального «сбросить всё» рядом с темой.
rule/preserve-user-input, rule/loading-stable-labels, rule/success-state-specific.

## 5. Поиск, Back, ошибки и приёмка

Поиск нормализует ё/е и регистр; ищет названия/keywords/владельца, не содержимое
личных записей. Result: «Сила наклона → Движение и жесты · На этом телефоне».
Выбор открывает страницу, скроллит к field anchor, подсвечивает без обязательного
движения, фокусирует label/control. Недоступный результат объясняет причину; owner-
only приватные поля не индексируются чужой роли. Back возвращает query и scroll.

Обязательные cases: default/changed/saving/failed/offline/forbidden/unavailable,
unknown future setting, disabled module, исчезнувший contribution, remote scope
switch во время Save, две одновременные записи, reload, 320px/200% text/TalkBack,
keyboard/Android Back, motion reduced, no network. Никакая ошибка не заменяет
storage пустым object и не превращает device preference в workspace mutation.
rule/cover-reachable-states, rule/error-states-recovery, rule/keyboard-complete-flow.

Самопроверка: brief есть, решения имеют действующие rule IDs; инженерное ownership
следует governing docs. Реализация новых страниц и дизайн-токенов — отдельные
проверяемые срезы, не выполнены одной публикацией этого проекта.
