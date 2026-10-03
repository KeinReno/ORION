# ORION Knowledge Hub

> Концепт модуля персональной базы знаний, редакционного контура и публикации в Telegram / Mini App / сайт.
>
> Статус: product/architecture note, не реализовано.
> Дата фиксации: 2026-10-03.

## 1. Идея

ORION должен быть не только персональным органайзером, но и источником истины для личной информационной экосистемы KAIDEN.

Вместо отдельных баз для сайта, Telegram-канала, Telegram Mini App и личных заметок создаётся один предметный модуль Knowledge Hub. Он хранит знания, источники, редакционные версии и историю публикаций. Telegram, Mini App и сайт становятся каналами ввода/вывода поверх ORION API.

Ключевой принцип:

**ORION хранит истину. Внешние каналы лишь принимают или показывают её.**

Примеры входов:
- пересланный пост из чужого Telegram-канала;
- ссылка на сайт / статью / GitHub;
- собственная короткая мысль;
- заметка или документ из ORION;
- файл;
- позже: browser clipper, RSS, email, API/connector.

Примеры выходов:
- личная база знаний внутри ORION;
- публичный Telegram-канал;
- Telegram Mini App;
- личный сайт KAIDEN;
- позже: дайджесты, экспорт, публичный API.

## 2. Почему это должен быть отдельный модуль

Обычной Note недостаточно. Знание в редакционном контуре имеет:
- происхождение и набор источников;
- оригинальный материал, который нельзя терять после AI-обработки;
- извлечённые факты, тезисы и сущности;
- категорию и теги;
- статус обработки;
- редакционную версию;
- несколько вариантов под разные каналы;
- историю AI-преобразований;
- историю публикаций;
- уровень доступа: private / shared / public.

Notes можно использовать как соседний тип контента и источник для Knowledge Hub, но KnowledgeItem должен быть собственной предметной сущностью.

## 3. Предлагаемое название

Рабочее название: **Knowledge Hub**.

В пользовательском интерфейсе возможно русское название **«База знаний»** или **«Библиотека»**.

Внутренний module key, например: `knowledge`.

## 4. Базовая модель данных

### KnowledgeItem

Основная единица знания.

Минимальные поля:
- `id`
- `workspaceId`
- `title`
- `summary`
- `body`
- `status`
- `visibility`
- `categoryId`
- `createdBy`
- `createdAt`
- `updatedAt`
- `publishedAt?`

Статусы первой версии:
- `CAPTURED` — сырьё принято;
- `ANALYZING` — идёт обработка;
- `DRAFT` — черновик готов;
- `REVIEW` — ожидает проверки;
- `APPROVED` — разрешён к публикации;
- `PUBLISHED` — опубликован хотя бы в одном канале;
- `ARCHIVED` — убран из активного потока.

Visibility:
- `PRIVATE`
- `WORKSPACE`
- `PUBLIC`

### KnowledgeSource

Оригинал всегда хранится отдельно от редакционной версии.

Поля:
- `id`
- `knowledgeItemId`
- `type`: telegram / url / note / document / file / manual / rss / other
- `sourceUrl?`
- `sourceTitle?`
- `sourceAuthor?`
- `sourceChannel?`
- `originalText?`
- `metadataJson?`
- `capturedAt`

Это принципиально: AI не должен уничтожать первоисточник после переписывания.

### KnowledgeCategory

Древовидная или плоская категория.

Примеры для KAIDEN:
- Противодействие мошенничеству
  - схемы
  - методики
  - инструменты
- Информационная безопасность
- Полезный ИИ
  - изображения
  - видео
  - музыка
  - разработка
- Разработка
- Финансы

На первом этапе дерево максимум 2–3 уровня, без попытки построить сложную онтологию.

### Tag

Свободные теги для поперечной классификации.

### KnowledgeRelation

Связи между материалами:
- related
- expands
- contradicts
- duplicate_of
- derived_from
- part_of

Позже это позволяет строить граф знаний без отдельного нового хранилища.

### ProcessingRun

История AI-операций:
- input version;
- модель / провайдер;
- operation type;
- результат;
- warnings;
- timestamps;
- user accepted/rejected.

Нужна для воспроизводимости и возможности вернуться к предыдущей редакции.

### Publication

Одна публикация конкретного KnowledgeItem в конкретном канале.

Поля:
- `id`
- `knowledgeItemId`
- `channelId`
- `status`: queued / scheduled / publishing / published / failed / withdrawn
- `renderedText`
- `externalMessageId?`
- `externalUrl?`
- `scheduledFor?`
- `publishedAt?`
- `error?`

Один материал может иметь несколько Publication: Telegram, Mini App, сайт и т.д.

### PublicationChannel

Настройки канала вывода:
- Telegram channel/chat;
- Mini App feed;
- web site section;
- template / tone / text limits;
- auto-publish policy.

Секреты не должны храниться в открытых полях модели.

## 5. Telegram как вход

Сейчас ORION TelegramService работает только как исходящая отправка сообщений. Для Knowledge Hub требуется отдельный inbound-контур.

Предлагаемый поток:

1. Пользователь пересылает боту чужой пост или сообщение.
2. Telegram webhook принимает update.
3. Bot gateway проверяет, что sender разрешён.
4. Создаётся Capture / KnowledgeSource с оригиналом.
5. Создаётся KnowledgeItem со статусом `CAPTURED`.
6. Запускается AI pipeline.
7. Бот отвечает карточкой результата: категория, краткое описание, уверенность, действия.
8. Пользователь может подтвердить, изменить категорию, открыть в ORION, отправить на публикацию или архивировать.

Желательные bot actions:
- Открыть в ORION
- Опубликовать
- В черновики
- Сменить категорию
- Сделать короче
- Сделать подробнее
- Добавить мой комментарий
- Запланировать
- Архивировать

Для первого релиза достаточно кнопок `Открыть`, `Одобрить`, `Архив`.

## 6. AI processing pipeline

AI здесь — не просто «рерайтер».

Этапы обработки:

### 6.1 Normalize

Извлечь текст, ссылки, вложения, автора/канал, дату, Telegram entities.

### 6.2 Classify

Определить:
- категорию;
- теги;
- тип материала: новость / методика / инструмент / инструкция / мнение / исследование / ссылка;
- предполагаемую аудиторию;
- уровень полезности / confidence.

### 6.3 Extract

Выделить:
- ключевые тезисы;
- факты;
- продукты / сервисы / организации;
- URL;
- даты;
- команды / инструкции;
- потенциальные claim-ы, которые требуют проверки.

### 6.4 Duplicate / similarity check

Проверить базу на похожий материал.

Результат:
- новый материал;
- дополнение к существующему;
- потенциальный дубль;
- конфликтующая информация.

### 6.5 Editorial transform

Создать собственную редакционную версию на основе фактов и смысла, а не косметически менять формулировки оригинала.

Важное правило продукта: источник сохраняется, а публикация должна быть самостоятельным изложением с добавленной структурой/контекстом. При необходимости указывается первоисточник.

### 6.6 Fact-check hook

Для утверждений, где актуальность критична, pipeline должен уметь поставить флаг `needsVerification` и не отправлять материал в auto-publish до проверки.

Сам web-search/fact-check можно реализовать отдельным service/provider позже.

### 6.7 Channel render

Формировать разные представления одной сущности:
- полный материал Knowledge Hub;
- короткий Telegram post;
- карточка Mini App;
- web article;
- digest snippet.

Это именно rendering layer, а не четыре независимых копии знания.

## 7. Пользовательский интерфейс модуля

### 7.1 Главный экран: Knowledge Inbox

Первый экран модуля — очередь входящих материалов.

Колонки / фильтры:
- Новые
- Анализируются
- Требуют решения
- Готовы
- Опубликованы

Карточка показывает:
- заголовок;
- источник;
- категорию;
- AI summary;
- статус;
- наличие дубля;
- предупреждения;
- кнопки действия.

Это должно ощущаться скорее как inbox/redaction queue, чем как обычная папка заметок.

### 7.2 Library

Каталог уже обработанных знаний.

Режимы:
- список;
- карточки;
- дерево категорий;
- поиск;
- saved views;
- позже — graph view.

Фильтры:
- категория;
- теги;
- тип материала;
- источник;
- visibility;
- published/unpublished;
- дата;
- качество/verification state.

### 7.3 Knowledge Editor

Трёхзонный экран:

**Слева — Source / Context**
- оригинальный пост;
- ссылки;
- вложения;
- источник;
- похожие материалы.

**По центру — Canonical content**
- title;
- summary;
- основной текст;
- категории / теги;
- связи.

**Справа — AI + Publishing**
- suggestions;
- actions: сократить / расширить / структурировать / перепроверить;
- варианты для Telegram / Mini App / Web;
- schedule / publish controls.

Оригинал и редакционная версия должны визуально быть разными сущностями.

### 7.4 Publication Queue

Отдельное представление для контент-плана:
- что готово;
- куда будет опубликовано;
- когда;
- что упало с ошибкой;
- что требует подтверждения.

Возможны список и календарь.

### 7.5 Sources

Экран подключений и источников:
- Telegram bot;
- каналы, с которых часто приходят материалы;
- RSS;
- browser clipper;
- later integrations.

## 8. Telegram-канал

Telegram-канал — publication target.

ORION отправляет пост через Bot API и сохраняет `message_id`/ссылку в Publication.

Должны поддерживаться два режима:

### Manual approval

По умолчанию. AI готовит пост, человек подтверждает публикацию.

### Auto-publish rules

Позже можно добавить правила вида:
- публиковать только категорию X;
- только confidence > threshold;
- не публиковать материал с `needsVerification=true`;
- не чаще N постов в день;
- определённые категории только после ручного approve.

Автопубликация не должна быть режимом по умолчанию.

## 9. Telegram Mini App

Mini App не должен иметь отдельную контентную БД.

Он читает через ORION API только материалы, разрешённые для публичного представления.

Пример структуры Mini App:
- Главная
- Категории
- Материалы
- Инструменты
- Методики
- Поиск
- Избранное (если появятся пользователи)

Для публичного read API нужен отдельный boundary: нельзя просто открыть внутренние workspace routes наружу.

Предлагается отдельный `public-content` projection/API, который выдаёт только whitelisted поля опубликованных `PUBLIC` KnowledgeItem.

## 10. Личный сайт KAIDEN

Сайт использует тот же public projection, что и Mini App.

То есть один KnowledgeItem может иметь:
- canonical version в ORION;
- Telegram Publication;
- Mini App representation;
- Web representation.

Обновление canonical материала может инициировать новую publication revision, но не должно незаметно редактировать уже опубликованный Telegram message без явной политики.

## 11. Интеграция с существующими модулями ORION

### Notes

- Note -> Send to Knowledge Hub.
- KnowledgeItem может ссылаться на Notes.

### Documents

- Document/File -> использовать как Source.
- PDF/MD/TXT и другие поддерживаемые документы могут поступать в ingestion pipeline.

### Inbox

Быстрый capture можно связать с существующим Inbox:
- пользователь вводит мысль;
- action `В базу знаний` создаёт KnowledgeItem.

Но Telegram capture лучше заводить прямо в Knowledge Inbox, чтобы не смешивать личные задачи и редакционную очередь.

### Projects

KnowledgeItem может быть связан с Project, если материал относится к конкретной работе.

### Notifications

ORION Notification Center сообщает:
- анализ завершён;
- требуется решение;
- публикация выполнена;
- публикация упала;
- обнаружен дубль / конфликт.

### Global Search

KnowledgeItem должен индексироваться общим поиском вместе с Notes, Documents и остальными сущностями.

## 12. Архитектурные границы

Предлагаемая структура backend:

```text
apps/api/src/knowledge/
  knowledge.module.ts
  knowledge.controller.ts
  knowledge.service.ts
  knowledge-ingestion.service.ts
  knowledge-processing.service.ts
  knowledge-publication.service.ts
  knowledge-search.service.ts

apps/api/src/integrations/telegram/
  telegram-bot.gateway.ts
  telegram-webhook.controller.ts
  telegram-client.service.ts
```

На ранней стадии Telegram integration может физически жить внутри `knowledge/`, но предметно лучше не смешивать transport с Knowledge domain. Telegram со временем будет нужен не только Knowledge Hub.

Shared contracts:

```text
packages/shared-types/src/knowledge/
packages/core/src/knowledge...
packages/core-react/src/knowledge...
apps/web/.../knowledge...
```

Следовать существующему вертикальному срезу ORION: shared-types -> core -> core-react -> web panel.

## 13. Очередь фоновых задач

AI-анализ и публикация не должны выполняться синхронно внутри HTTP webhook.

Webhook должен:
1. валидировать update;
2. сохранить capture;
3. поставить processing job;
4. быстро вернуть 200 Telegram.

Для первой версии допустима DB-backed job table/worker. Полноценный Redis/BullMQ имеет смысл только если нагрузка реально потребует этого; не вводить инфраструктуру заранее.

Нужны retry/idempotency:
- Telegram update id;
- publish idempotency key;
- processing attempt count;
- last error.

## 14. Безопасность

- Telegram webhook secret/token validation.
- Allowlist Telegram user IDs для приватного bot inbox.
- Bot token только через secrets/env.
- Никаких прямых public workspace endpoints для Mini App/сайта.
- Public projection выдаёт только опубликованные PUBLIC записи.
- RLS сохраняется для внутренних данных.
- Логи не должны содержать bot token и чувствительные payloads целиком.

## 15. MVP

Первый полезный релиз должен быть узким.

### MVP-1: Knowledge core

- KnowledgeItem;
- Source;
- Category;
- Tag;
- статусы;
- Inbox + Library + Editor;
- ручное создание материала;
- поиск через существующий ORION search.

### MVP-2: Telegram capture

- webhook;
- allowlist одного владельца;
- пересланный text post -> Source + KnowledgeItem;
- bot acknowledgement;
- dedupe по Telegram update/message identifiers.

### MVP-3: AI processing

- summary;
- classification;
- tags;
- suggested title;
- editorial draft;
- similarity warning.

### MVP-4: Telegram publishing

- preview;
- manual approve;
- публикация в один Telegram channel;
- сохранение external message ID/status;
- retry/error state.

### MVP-5: Public projection + Mini App

- read-only public API;
- категории;
- карточки;
- material details;
- search.

Сайт можно подключить затем к тому же API без изменения основной модели.

## 16. Что не делать в первой версии

- сложную графовую БД;
- универсальный plugin marketplace;
- автопубликацию без approval;
- десятки AI-провайдеров;
- полноценный crawling всего Telegram;
- отдельную БД Mini App;
- отдельную CMS для сайта;
- тяжёлую vector infrastructure до появления реальной потребности;
- автоматическое удаление/замену исходников после AI-обработки.

## 17. Product vision

Knowledge Hub превращает ORION из персонального productivity-приложения в личную цифровую платформу.

Один и тот же объект знания может существовать в нескольких контекстах:
- приватный — только для владельца;
- workspace — семейный/командный;
- публичный — Telegram / Mini App / web.

Долгосрочная схема:

```text
Telegram forwards ─┐
Web / URLs ─────────┤
Notes / Documents ──┤
Manual capture ─────┤
RSS / other ────────┘
        ↓
      Ingestion
        ↓
   Knowledge Hub
        ↓
 AI analysis / links / verification
        ↓
 Canonical KnowledgeItem
        ↓
 Editorial approval
        ↓
 ┌────────────┬──────────────┬──────────────┐
 Telegram     Mini App       KAIDEN Web    Other
```

ORION остаётся единственным источником истины. Каналы распространения не владеют canonical content.

## 18. Ключевое решение на текущем этапе

Для реализации концепции не нужен отдельный Telegram-проект и не нужна новая самостоятельная CMS.

Рекомендуемое направление:

**создать в ORION модуль Knowledge Hub, а Telegram/Mini App/Web реализовывать как интеграции и presentation layers поверх него.**

Это соответствует текущему модульному устройству ORION и позволяет постепенно расширять систему, не создавая параллельные базы и несвязанные версии одного и того же контента.
