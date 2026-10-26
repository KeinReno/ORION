# Android alpha.27 — поиск и переходы в финансах

Статус: HISTORICAL, 26.10.2026. Базовый HEAD 553763da; исходная ревизия
указана в GitHub release. Текущие факты — [STATUS](../STATUS.md), направление —
[PLATFORM](../PLATFORM.md). Ограниченный UI/UX-срез по просьбе владельца,
без изменения схемы хранения, LAN-протокола и десктопных исходников.

## Изменения

- Общий ModuleSearch для задач/заметок: отдельный 48×48 target очистки,
  сохранение focus в поле, один cancel вместо native WebView cancel + кнопки.
- Пустая выдача предлагает снять поиск и фильтры одним действием. В архиве
  заметок действие очищает ограничения внутри архива, не переключает область.
  Выбранный порядок сохраняется. Подпись о закреплённых видна, когда они есть.
- Финансы: явные переходы ввод ↔ история с focus/scroll; у выбранного другого
  месяца доступен возврат к текущему. Пустая история объясняет выбранный период.
- Попытка открыть операцию при заполненном черновике не теряет ввод: отдельное
  предупреждение получает focus и прокрутку в видимую область, затем кнопка
  возвращает к черновику. Это больше не ошибка суммы, спрятанная выше формы.
- Расход/доход переносятся целыми кнопками на узком экране при крупном шрифте.
  Темы, иконки нижней навигации и действующие жесты сохранены.

## Проверки

- Android typecheck / Vite production build / Capacitor sync PASS.
- Scoped ESLint PASS; Impeccable mechanical detector: [] до последней локальной
  правки focus предупреждения (после неё ESLint/typecheck/browser проверены снова).
- 99 Android/mobile-core unit tests, 11 plugin-contract tests PASS.
- architecture-check PASS; 11 JVM tests PASS.
- android-capture-recovery-smoke: clear/focus/48px, поиск+фильтр/reset,
  черновик при коллизии edit, видимость/focus предупреждения, переходы,
  текущий месяц, отсутствие horizontal overflow при 320/900px и font200 PASS.
- android-module-polish-smoke и android-finance-smoke PASS: Markdown preservation,
  CRUD, точные суммы, durable browser draft, delete confirmation, backup,
  320/412/900px, font130/200. Контексты изолированы, записи синтетические.
- Общий WebView UI просмотрен в Chromium, dark/light, 412 и 320px. Найденный
  перенос слова «Расход» на font200 исправлен и просмотрен повторно.
- assembleDebug / assembleRelease / lintDebug / testDebugUnitTest PASS.
  Release variant unsigned; публикуется test/debug signed APK.

Физическая приёмка alpha.27 на OPPO НЕ выполнялась: владелец ушёл, телефон и
живые данные не трогались. Browser checks не подтверждают Android IME, TalkBack,
ColorOS/font scale, native SQLite и LAN/VPN. Следующий ручной smoke: поиск,
пустая выдача, финансовый черновик/редактирование и клавиатура на OPPO.

## Пакет и публикация

0.1.26 / alpha.27 / code27, io.kaiden.orion.android. 4424368 байт.
SHA-256: `a2c70646e94a6a073ccdcb01edd705d37d1c31561ab481e5c1960e9a6d681484`.
Signer SHA-256: `5154216cb718e2d66a6811ce8168fd571ecfcacd7c15fd6e39d2e0ad29023b39`.
Release helper подтвердил package, UI/native versions, code26→27, signer continuity,
size/hash. [Публичный APK-релиз](https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.26-android-alpha.27).
Публикация — только APK, описания, manifest и checksum. Финансы остаются локальными;
сервер v1 из предыдущего commit не подключён к мобильному клиенту этим срезом.

Файлы: module-search.tsx, tasks-screen.tsx, notes-screen.tsx, finance.tsx,
presentation.css, Android version files, android-capture-recovery-smoke.mjs,
STATUS и этот отчёт. Main checkout и пользовательские профили не менялись.

Служебные PRODUCT.md/DESIGN.md распознаны как старый формат Impeccable:
обновление product record принадлежит `init`; поле Platform содержит описание
вместо enum android. В этот ограниченный срез их миграция не включена; Android
reference прочитан вручную, ограничения физической проверки перечислены выше.
