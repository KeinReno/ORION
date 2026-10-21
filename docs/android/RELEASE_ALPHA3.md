# Android alpha.3 — экспорт и LAN

21.10.2026. Версия 0.1.2 / versionCode 3. Целевое устройство: OPPO Reno8 5G.

## Результат
Резервный экспорт через Android SAF; нативный TLS transport с точным pinning;
сопряжение кодом существующего сервера; Keystore для секретов; вход и выбор
пространства; отдельные durable replicas; задачи/заметки, ручная синхронизация,
CAS-конфликты и явный идемпотентный перенос независимых записей телефона.
Архитектура и границы: [LAN_ALPHA3.md](LAN_ALPHA3.md).
Сервер, desktop, shared contracts и persisted desktop data не изменены.

## Проверено локально
| Проверка | Результат |
|---|---|
| Workspace typecheck | PASS |
| ESLint | PASS, 0 ошибок / 29 предупреждений |
| Unit | PASS, 189 файлов / 1464 теста, включая 21 mobile-core |
| Architecture, plugin-contract, module-docs | PASS; 11 plugin tests |
| Android build + Capacitor sync | PASS |
| assembleDebug / assembleRelease / lintDebug / testDebugUnitTest | PASS |
| Android lint | 0 ошибок / 31 предупреждение |
| JVM | 9 тестов: 4 updater + 5 реального локального TLS/pairing policy |
| Browser offline + settings smoke | PASS; restart, draft, archive, updates, 320px/font130 |
| APK | apksigner PASS; package/signature совместимы с alpha.2; code 2→3 |

Sync-тесты используют synthetic MemoryHost и общий ReplicaEngine: потеря ответа,
перезапуск, локальный отказ записи, два клиента/CAS, импорт/ledger и отзыв доступа.
JVM TLS-тесты проверяют настоящее локальное рукопожатие: первичная проба не
посылает HTTP, подмена leaf блокируется до передачи Authorization.

## APK
Публикуется подписанный debug APK с прежним тестовым ключом. Release variant
также собран, но unsigned artifact не предлагается для установки.
Размер 4 292 008 байт. SHA-256:
`5a5d8d8b443b97ff8020b1bdd32fada802967359419dcbaeb87f763e7efb9182`.
Сертификат SHA-256:
`5154216cb718e2d66a6811ce8168fd571ecfcacd7c15fd6e39d2e0ad29023b39`.
Public release: https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.2-android-alpha.3
В публичном репозитории только APK, checksum, manifest и описание.

## Честные ограничения и следующий шаг
Нет подключённого Android/emulator: Android SAF, Keystore, SQLite migration,
системный установщик и полный реальный LAN-поток на OPPO здесь NOT RUN.
Автоматизированные browser/JVM/mock проверки не заменяют эту приёмку.
Фоновая синхронизация и восстановление экспортированного JSON через UI не реализованы.
Обновления проверяются в открытом приложении; установку подтверждает Android.
Не запускались database integration suite и desktop packaging: сервер/desktop не менялись.
GitHub Actions ранее блокировались billing/spending policy; результат выше локальный.

Приёмка владельцем:
1. Обновить поверх alpha.2, убедиться в сохранности записей, сохранить JSON.
2. Включить LAN host на ПК, разрешить сеть в firewall, включить hybrid у пространства.
3. На телефоне указать LAN-адрес, подтвердить его код на ПК, войти и выбрать пространство.
4. Создать/изменить записи с обеих сторон, вручную синхронизировать; повторить без Wi-Fi
   и после перезапуска, затем проверить конфликт заметки и явное копирование записей.
5. Проверить отмену экспорта, logout и отзыв устройства; независимые записи телефона
   должны остаться. При изменении сертификата подключаться заново с подтверждением.
