# KAIDEN Orion Android

Статус: IMPLEMENTING, 21.10.2026. Основание: прямое поручение владельца.
Аудит исходников: `bae18a1be35c9b26cf42f6727c6820ddefa38ff7`, совпадает с GitHub master.
Устройство приёмки: **OPPO Reno8 5G**, версия Android/ColorOS пока не проверена.

## Структура frontend (частично реализована в alpha.13)

- [Архитектура роста и этапы безопасной миграции](FRONTEND_ARCHITECTURE.md)
- [Центр настроек: все разделы, scopes, сохранение и поиск](SETTINGS_SPEC.md)
- [Мобильные поверхности всех модулей и критерии полноценного среза](MODULE_SURFACES.md)
- [Предложение mobile UI contribution contracts](EXTENSION_PROPOSAL_MOBILE_UI.md)

Alpha.13 реализует bundled shell, центр настроек и Lists. Полный SDK и перенос всех модулей остаются проектом.

- [Alpha.13: реализация, проверки и оставшиеся этапы](RELEASE_ALPHA13.md)

## Действующие реализации и отчёты

- [Alpha.21: интерфейс подключения, индикатор и формы](RELEASE_ALPHA21.md)

- [Alpha.20: автоматический обмен и области данных](SYNC_FOREGROUND_ALPHA20.md)

- [Alpha.19: обнаружение LAN и сохранённая идентичность](LAN_DISCOVERY_ALPHA19.md)

- [Alpha.18: проверка чек-листов и восстановления](RELEASE_ALPHA18.md)

- [Alpha.17: восстановление из копии и чек-листы при создании](RELEASE_ALPHA17.md)

- [Восстановление из резервной копии: семантика и ограничения](BACKUP_RESTORE.md)
  (в alpha.17)

- [Создание задачи: чек-лист, перенос строк и форматирование](TASK_CREATION.md)
  (в alpha.17)

- [Alpha.16: чек-листы внутри задач](RELEASE_ALPHA16.md)

- [Alpha.15: Markdown, порядок и плановое время](RELEASE_ALPHA15.md)

- [Alpha.14: поля и фильтры задач/заметок](RELEASE_ALPHA14.md)

- [Концепция](CONCEPT.md)
- [Архитектура](ARCHITECTURE.md)
- [Синхронизация](SYNC.md)
- [Первый релиз и проверка](RELEASE.md)
- [Настройки и обновления](UPDATES.md)
- [Alpha.2: результаты проверки](RELEASE_ALPHA2.md)

Приоритеты: AGENTS.md → PLATFORM.md → ORION_CONSTITUTION.md.
Android — отдельная клиентская поверхность, не новый предметный модуль и не
перенос desktop-окон на телефон. Документы не утверждают готовность LAN.
Старый ChatGPT-чат недоступен в полном виде: инструмент вернул ссылки-заглушки.
Решения ниже выведены из проверенного кода и текущего задания.

Текущий срез: [alpha.3 — экспорт и LAN](RELEASE_ALPHA3.md), [архитектура](LAN_ALPHA3.md).
Реальный обмен OPPO ↔ ПК требует ручной приёмки.

[Alpha.4 — быстрый ввод финансов и результаты проверки](FINANCE_ALPHA4.md).

[Alpha.5 — общие темы KAIDEN](RELEASE_ALPHA5.md); [жесты и голосовой ввод: проект](DESIGN_AND_CAPTURE.md).

[Alpha.6 — кнопка системной диктовки](RELEASE_ALPHA6.md).

[Alpha.7 — быстрые действия, порядок задач и актуальная дата](RELEASE_ALPHA7.md).

[Alpha.8 — визуальная доработка и движение](RELEASE_ALPHA8.md).

[Alpha.9 — удержание, глубина и компоновка](RELEASE_ALPHA9.md).

[Alpha.10 — сила наклона и проверка датчика](RELEASE_ALPHA10.md).

[Alpha.11 — согласованные объёмные карточки](RELEASE_ALPHA11.md).

[Alpha.12 — явные действия записей и усиленная глубина](RELEASE_ALPHA12.md).
