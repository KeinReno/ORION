# Android alpha.2 — настройки и обновления

21.10.2026; основа ea396bd (alpha.1). Версия 0.1.1 / versionCode 2.
Проверка alpha.1 на OPPO: владелец сообщил «Вижу, что все ок»; это ручная
обратная связь, а не инструментальная проверка SQLite/ColorOS.

## Изменения
- Настройки устройства: тема, автопроверка, необязательная автозагрузка по Wi-Fi.
- Отдельный публичный источник KeinReno/ORION-Android-Releases разрешён
  владельцем; в APK нет GitHub credentials, исходники остаются приватными.
- Проверка при открытии/возобновлении приложения с интервалом 6 часов,
  ручная проверка, описание релиза и прогресс.
- Нативная загрузка APK с ограничением источника, размера, времени,
  проверкой SHA-256, applicationId, versionCode и сертификата.
- Системное разрешение установки запрашивается в контексте действия.
  Отмена установщика позволяет повторить установку.
- Совместимое чтение snapshot alpha.1; задачи, заметки, очередь и device ID сохраняются.
- Подготовка manifest скриптом android-release.mjs: подпись и совместимость
  проверяются относительно предыдущего APK до публикации.

## Доказательства
| Проверка | Результат |
|---|---|
| Typecheck всего workspace | PASS |
| Unit | PASS, 188 файлов / 1455 тестов; 12 mobile-core |
| Нативная UpdatePolicy, JVM | PASS, 4 теста источника/версии/подписи |
| ESLint | PASS, 0 ошибок / 29 существующих предупреждений |
| Architecture / plugin-contract / module-docs | PASS |
| assembleDebug, assembleRelease, lintDebug, testDebugUnitTest | PASS |
| Android app lint | 0 ошибок / 29 предупреждений шаблонных ресурсов и обновлений зависимостей |
| Browser offline smoke alpha.1 | PASS |
| Browser settings/update smoke | PASS: автопроверка, новые/текущие версии, описание, темы, настройки после reload, ошибка сети, 320px/шрифт 130% |
| OPPO: системный установщик, grant permission, загрузка/обновление поверх alpha.1 | NOT RUN в этой сессии |
| Фоновая проверка при закрытом приложении | NOT IMPLEMENTED; проверка только в открытом приложении |
| LAN | Не входит в alpha.2, остаётся подготовка |
| Полные PostgreSQL/RLS integration tests, Windows installer | NOT RUN; их исходники/схема не менялись |

Перед установкой alpha.2 не удалять alpha.1. Сохранение данных при Android
обновлении требует совпадения package/signing key и увеличения versionCode;
первые два параметра проверяются скриптом по фактическим APK.

## Изменённые области
apps/android: раздел настроек, updater hook/bridge, native policy/plugin,
permissions/file provider, version 2. packages/mobile-core: additive settings,
manifest schema и тесты. scripts/android-release.mjs,
scripts/android-settings-smoke.mjs; Android workflow и документация.
Серверные и desktop исходники не менялись.

## Следующие шаги
Ручная установка alpha.2 поверх alpha.1 на OPPO, проверка прежних записей;
следующий релиз через встроенный updater; затем защищённая LAN-синхронизация.
Ключ тестовой подписи необходимо сохранить вне Git для следующих alpha.

Устанавливаемый APK: 4 424 328 байт.
SHA-256: b0b67f0035296cc9c0fd3a8b058464f1489e296423ea4f6dacf4a8a29b9afbe5.
Сертификат SHA-256 совпадает с alpha.1:
5154216cb718e2d66a6811ce8168fd571ecfcacd7c15fd6e39d2e0ad29023b39.
