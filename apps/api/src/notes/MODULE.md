# Заметки (`notes`)

Текстовые заметки в Markdown: ревизии, wiki-ссылки, теги, шаблоны, корзина.

Вложения заметок — обычные документы (`note-attachments.service.ts` поверх `DocumentsService`), своего хранилища у модуля нет. Корзина чистится ночным кроном `note-trash-purge.service.ts`.

Обновление тела идёт через проверку ревизии (CAS); прямые записи мимо `NotesService.update` ревизию не увеличивают.

Работает без документов и проектов.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `notes` / 1.0.0 (платформа ^1.0.0) |
| Вид | базовый, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `documents`, `projects` |
| Права (permissions) | — (в манифесте пока не объявлены) |
| События | публикует: —; слушает: — |
| Панели веба | `notes` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/notes` |
| Плагины, расширяющие модуль | `notes-history`, `notes-daily`, `notes-templates` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/notes/` |
| При выключении | Панель и API скрываются. Заметки и ревизии сохраняются. |
<!-- generated:manifest:end -->
