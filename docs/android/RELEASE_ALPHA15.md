# Android alpha.15 — чтение и порядок записей

21.10.2026; 0.1.14/code15. Срез Tasks/Notes на существующих публичных контрактах.
Desktop/API/public DTO/identity и схемы хранения не менялись. Нижние иконки сохранены.

## Что реализовано
В редакторе задачи и заметки раскрывается Markdown preview: headings, emphasis,
списки, цитаты, code fences и таблицы стандартного markdown-it. HTML отображается
текстом. Renderer никогда не создаёт anchors/images: ссылки — подпись, изображение —
текстовый placeholder. Нет автоматических внешних запросов/переходов и wiki navigation.
Исходный body сохраняется без преобразования. Preview lazy-loaded отдельным chunk
только при раскрытии; закрытие/смена текста отменяет публикацию устаревшего результата.
Ошибка загрузки сохраняет editor и даёт явный способ повторить открытие.
Это mobile renderer существующего содержания, не замена desktop MarkdownView.

Порядок задач: ручной, по сроку (без срока в конце), приоритету или названию.
Закрытые остаются после открытых. Manual использует прежний локальный taskOrder;
автосортировка не сохраняет порядок и отключает drag/reorder, как фильтр/поиск.
Порядок заметок: по изменению текста (editedAt с fallback updatedAt), созданию,
названию; закреплённые всегда первыми. Новые сортировки живут в текущем запуске,
не меняют server sortOrder и после restart возвращаются к defaults.

У задачи доступны начало и плановая оценка в минутах, отдельно от срока. Срок,
начало и оценку можно очистить. Строковый draft сохраняет невалидную попытку;
Save допускает целые 0..10 000 000 (общий SyncOp limit), пустое = null. Legacy
optional fields не очищают плановые поля; initial edit читает текущие значения.
При начале позже срока показывается предупреждение без изменения исходных дат.
Это не таймер, recurrence или новая реализация planning plugin. Изменяем только
поля startAt/estimatedMinutes существующего публичного offline task contract.

## Проверки
- 50 focused tests PASS: 44 mobile-core и6 Android architecture/filter/preview/order.
  Новые: planning legacy/restart/clear/invalid/disk failure; remote planning через
  synthetic MemoryHost; HTML escaping/no anchors/images; stable sort/pin/closed groups.
- 12 browser scripts PASS: все11 alpha.14 и новый reading smoke. Create/reload/clear
  начала и оценки, invalid retry, все сортировки задач, drag guard, preview на320px/200%,
  отсутствие XSS/внешних image requests, сохранность raw Markdown и pin ordering.
- Workspace typecheck; lint0 errors/29 existing warnings; architecture/module-docs,
  11 plugin-contract tests PASS.
- assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS (9 existing JVM tests).
  Main JS ~601kB, preview chunk~115kB; >500kB Vite warning и native lint baseline остаются.
  Публикуется debug APK с прежним тестовым сертификатом; release variant unsigned.

## Изменённые файлы
apps/android/src/features/{markdown-preview,markdown-render,view-order} и render test;
features/{entry-fields,tasks/tasks-screen,notes/notes-screen}, app/App.tsx, style.css;
package.json/updates.ts/android/app/build.gradle; pnpm-lock.yaml (Android direct
markdown-it/type dependency тех же версий, уже применяемых в @orion/ui).
packages/mobile-core/src/mobile-models.ts, mobile.test.ts, remote-client.test.ts;
scripts/android-reading-smoke.mjs и version fixtures settings/depth; README/STATUS/report.

## Ограничения и далее
OPPO Reno8 5G/ColorOS/native date picker/TalkBack и настоящий Windows LAN NOT RUN.
Browser и MemoryHost не заменяют физическую приёмку. Наклоны не менялись.
Нет фоновых reminders, media attachments/download, history/trash restore, полного
project/team/recurrence/planning UI и dynamic plugin SDK. Следующий шаг — проверить
новые поля/preview на телефоне и физический LAN/CAS; затем переносить следующий
модуль либо отдельно спроектировать attachments/entity tables с recovery/backup.
