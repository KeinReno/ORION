# 06 — База знаний 2.0 (backend)

**Зона ответственности:** `apps/api/src/knowledge/**`, `apps/api/src/search/**
(точечно), Prisma-блок `BEGIN 06`, миграции, тесты knowledge.
**Волна:** 2. **Никакого фронтенда.**
Локальные документы: `docs/KNOWLEDGE_HUB.md`, `docs/KNOWLEDGE_STABILIZATION_2026-10-23.md`,
`adr/ADR-0049-knowledge-collections-and-project-links.md`.

## Контекст

Уже есть: `KnowledgeCategory`, `KnowledgeItem`, `KnowledgeSource` (файлы через
Documents с сохранением структуры), коллекции, nullable projectId,
`InboxItem` (входящие — отдельная поверхность). План (раздел 8 переписки):
Knowledge Workspace — происхождение материалов, полнотекстовый поиск,
версии, входящие, агентный доступ.

## Задачи

### 6.1. Происхождение и проверка

- На `KnowledgeItem`: `origin` (jsonb: sourceFile, importedAt, sourceUrl?,
  author?, importedBy), `lastVerifiedAt` (nullable), `verificationState`
  (unverified | verified | outdated) с audit-событием смены.
- Endpoint `POST /knowledge/:id/verify` — фиксация проверки (кто/когда);
  при изменении содержимого материала состояние сбрасывается в `unverified`.
- Фильтр по verificationState и сортировка «просроченные проверки»
  (lastVerifiedAt + порог из настроек workspace, default 90 дней).

### 6.2. Полнотекстовый поиск

- Материализованная колонка `searchVector` (tsvector, конфигурация `russian`)
  по title/content/summary; обновление триггером миграции + из сервиса.
- `GET /knowledge/search?q=&type=&verified=&projectId=&from=&to=`: tsquery с
  ранжированием (ts_rank), подсветка-фрагменты (ts_headline) для сниппетов.
- Регистрация как provider в глобальном поиске (интерфейс задания 10 —
  реализовать свой модульный provider по соглашению, которое задание 10
  формализует: до его готовности — собственный endpoint, адаптер позже).

### 6.3. Версии материалов

- `KnowledgeItemRevision`: snapshot (title/content/summary/origin) на каждое
  значимое изменение (не на каждый autosave — по явному save/опубликованной
  правке); лимит хранения (последние N=20, настраивается); restore —
  создание новой актуальной версии из revision (история не перезаписывается).

### 6.4. Входящие и импорт

- Интеграция `InboxItem`: маршрутизация входящего в Knowledge (команда
  «сохранить в базу знаний»): создание item из capture (файл/ссылка/текст),
  заполнение origin, удаление из входящих — отдельным подтверждением.
- Массовый импорт файлов как самостоятельных материалов (не вложений в
  статью): переиспользовать существующий механизм Documents; атомарность —
  пофайловый отчёт (ok/failed+причина), без остановки на первой ошибке.

### 6.5. Агентный доступ

- MCP-tools (поверх существующего `apps/api/src/mcp/`): `knowledge.search`,
  `knowledge.read` с permission-gating (`knowledge.read`), аудит чтений
  агентами (`agent-hub` аудит — по существующим механизмам), отдача только
  verified/unverified — с явной пометкой состояния в результате.

## Критерии приёмки

1. Поиск на русском и английском содержимом находит оба, ранжирует точную
   фразу выше (интеграционный тест с фикстурами).
2. Правка материала сбрасывает verified → unverified; verify endpoint
   фиксирует автора и время.
3. Restore revision не затирает историю (две новые правки после restore
   остаются различимыми).
4. MCP-инструмент недоступен агенту без permission (тест).
5. Проверки из `00-README.md` зелёные; миграции с нуля PASS.
6. Отчёт-блок в `docs/STATUS.md`.

## Out of scope

Семантический поиск (только интерфейс-провайдер с no-op реализацией и местом
подключения), веб-краулер, OCR, фронтенд-библиотека, синхронизация внешних
источников.
