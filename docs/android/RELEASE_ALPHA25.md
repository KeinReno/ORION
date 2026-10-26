# Android alpha.25 — восстановление foreground-обмена

Статус: HISTORICAL, проверка 26.10.2026. Базовый HEAD b6f93a6 плюс изменения
этого отчёта; точный source commit записан в GitHub release.
Текущие факты — [STATUS](../STATUS.md), направление — [PLATFORM](../PLATFORM.md).

## Причина и изменение

Событие resume/online могло прийти во время ещё выполняющегося запроса.
Старый scheduler пропускал его из-за `running` и ждал следующего 15s poll.
Регрессионный тест до исправления получил 1 запрос вместо ожидаемых 2.
Теперь такие wake-события объединяются в один повтор после завершения текущего
запроса. Параллельные запросы не создаются. Повтор заново проверяет active,
blocked, revoked и stopped; уход в фон и cleanup не запускают отложенный обмен.

При запуске native-активность больше не считается `true` по умолчанию:
сначала регистрируется `appStateChange`, затем читается `App.getState`.
Поздний ответ initial read не перекрывает новое событие pause/resume.
Cleanup удаляет и поздно завершившуюся регистрацию. Неизвестное native-состояние
оставляет автоматический обмен на паузе; ручной sync остаётся доступен.
При смене native-активности сбрасывается прежнее подтверждение связи:
после возврата нужен свежий ответ ПК. Завершение ручного действия будит scheduler,
чтобы событие, пришедшее при blocked, не ждало очередного poll.

Нативные разрешения, TLS pinning, pairing, контракты, схема БД и Windows-код
не менялись. Phone-local и finance не импортируются автоматически.

## Проверки

- 111 профильных tests / 20 files: Android, mobile-core, core sync. Включают
  coalesced resume во время долгого запроса, background/stop guards, native
  initial-read race и cleanup, а также потерянный push response, 10 минут
  синтетического background и перезапуск клиента с очередью без дублирования.
- Workspace typecheck и changed-file lint прошли. Первичная ошибка TS2550
  в новом тесте (`Array.at` вне target lib) исправлена через `slice`; проверка
  повторена. Публичный target/runtime не менялся.
- Architecture, 11 plugin-contract tests, module-docs и platform-map прошли.
  Browser list CRUD/reload/drafts/backup/320px и settings/update manifest прошли.
- Android web build, cap sync, assembleDebug, assembleRelease, lintDebug,
  testDebugUnitTest прошли. Сохранились baseline bundle-size/Gradle warnings.
- Физический OPPO Reno8 5G CPH2481 / Android15: `adb install -r` поверх alpha.24;
  полный native snapshot совпал с сохранённым до обновления, identity и pairing
  сохранены. Подтверждённая связь восстановилась без ручного переподключения.
- Для реального outage временно остановлены только проверенные launcher/API
  установленного Windows beta.25, PostgreSQL не останавливался. На телефоне
  создана синтетическая заметка: pending=1, индикатор снял подтверждение связи.
  Штатный launcher запущен с тем же каноническим phone-linked профилем.
  После восстановления заметка автоматически доставлена ровно один раз;
  pending=0, conflicts=0. Исходные task docs ПК совпали с private baseline.
  Заметка удалена через Android, удаление подтверждено, replica notes=0;
  полный локальный snapshot телефона не изменился. API/DB health после проверки ok.
- Владелец заблокировал OPPO и затем снова открыл Orion. При заблокированном
  экране ADB показывал `mWakefulness=Dozing`, `pidof` не находил процесс Orion;
  CDP-соединение оборвалось. После открытия появился процесс приложения,
  восстановились тот же snapshot/replica и прежняя привязка, индикатор получил
  свежее подтверждение ПК, pending=0/conflicts=0. Полный локальный snapshot
  совпал с baseline до обновления. Это короткая блокировка и повторный запуск,
  не длительная Doze-приёмка; причина исчезновения процесса отдельно не установлена.

## Выпуск

0.1.24 / alpha.25 / versionCode25, `io.kaiden.orion.android`.
APK 4420778 байт, SHA-256:
`82a94c2be9a7728aa293df3da7afe42cea93a758cf4a5ac6c4c7de70ecec9cb3`.
Сертификат SHA-256:
`5154216cb718e2d66a6811ce8168fd571ecfcacd7c15fd6e39d2e0ad29023b39`.
Release-helper проверил рост code24→25, package, прежнего signer, версию UI/native,
размер и hash. Публичный APK — test/debug signed, unsigned release не выдаётся
за production-подписанный. [Публичный релиз](https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.24-android-alpha.25).

## Границы

Обмен по-прежнему foreground-only. Короткая блокировка, outage сервера и
синтетический background не доказывают работу при длительном Doze/выгрузке
процесса ColorOS, смене LAN-адреса/сети или VPN. Это следующие аппаратные сценарии.
Синхронизация финансов остаётся отдельной задачей с проектированием контрактов.
Документ не требует отключать оптимизацию батареи и не обещает постоянный фон.
