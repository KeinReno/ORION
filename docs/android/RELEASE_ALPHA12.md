# Android alpha.12 — базовые действия и управляемая глубина

21.10.2026; 0.1.11 / code 12. OPPO Reno8 5G — устройство ручной приёмки.

## Изменения
Tasks и Notes получили явную кнопку «…» у каждой записи. Inline actions: изменить,
удалить, закрыть; удаление требует отдельного названного подтверждения и показывает
scope. Существующее нажатие на заголовок открывает editor; незавершённый draft не
перезаписывается другим объектом. Сохраняются completion/reopen, archive/restore,
поиск, priority и Markdown. Полный набор desktop fields/attachments/trash restore
этот срез не обещает.

MobileRepository.deleteEntry использует существующий SyncOp delete и applyOpLocally
в одной durable transaction. Удаляются только выбранная запись, её draft и local
task-order reference; посторонние drafts/records не затрагиваются. Ошибка диска не
публикует удаление. Local delete не имеет undo в этой alpha, это указано до действия.
Remote delete через MobileRemoteClient: included check, expectedRevision, existing
ReplicaEngine queue, recovery after failed storage. Это не новый sync format.
Сервер разрешает/отвергает операцию при обмене; UI не обещает подтверждение ПК
после одного локального enqueue. Черновик удалённой remote записи очищается отдельно.

Depth: каждый interactive card теперь одна flat rendered plane. Из content убраны
индивидуальные Z transforms; descendants не создают конкурирующие 3D hit planes.
Base header/page heading — Z0; content card — до 24px; только декоративный preview
демонстрирует два уровня. Fixed overlays не вращаются. Root matrix общая, XY
translation полная, не 30% как раньше; внутренние тексты/кнопки не контрвращаются.
Strength 100%: 28° / 32 CSS px; sensitivity gain 1.5 до clamp. Default 60%.
Неподвижные рамки targets не обещаются: card действительно поворачивается; при
contact сохраняется фактическая matrix, чтобы удержать цель под пальцем.
Input/background/reduced-motion gates и native sensor availability сохранены.

## Проверки
- Mobile-core 36 tests PASS: deletion restart/atomic failure/draft preservation,
  remote durable delete и convergence двух synthetic клиентов, failed delete recovery.
- Workspace typecheck PASS; ESLint 0 errors / 29 прежних warnings.
- Architecture, module-docs PASS; plugin contracts 11 tests PASS.
- 9 browser mobile scripts PASS. Expanded synthetic depth regression теперь проходит
  task и note create/edit/delete + cancel при tilt, проверяет raw Markdown, row
  center direction на positive/negative X, отсутствие transform на тексте, общую
  rotation block matrix, strength, frozen touch targets и недоступность датчика.
- После последней правки common translation повторены depth и gesture scripts.
- assembleDebug / assembleRelease / lintDebug / testDebugUnitTest PASS.
- Vite bundle warning сохраняется. Release variant unsigned, публикуется debug
  APK с прежним тестовым сертификатом и возрастающим code.

## Ограничения и приёмка
Native OPPO sensor/sign/FPS/TalkBack и настоящий Windows LAN exchange не проверены
в этом сеансе. Synthetic UI/MemoryHost не доказывают работу физического датчика и
сервера. Установить поверх прежней alpha, проверить tilt 60/100%, меню «…», edit,
cancel delete и confirmed delete, restart, archive/reopen, text input и background.
Для remote delete проверить scope и отдельное server sync acknowledgement.

Схема следующей frontend-архитектуры и settings — отдельный PROPOSED проект;
эта сборка не включает новый settings hub/SDK/все domain modules.

## Файлы
apps/android/src/entry-actions.tsx, main.tsx, task-list.tsx, depth-card.tsx,
presentation.css, use-depth.ts, updates.ts; apps/android/package.json;
apps/android/android/app/build.gradle; packages/mobile-core/src/index.ts,
remote-client.ts, mobile.test.ts, remote-client.test.ts;
scripts/android-depth-smoke.mjs, android-settings-smoke.mjs; этот отчёт.
Desktop/API/public DTO не изменялись.
