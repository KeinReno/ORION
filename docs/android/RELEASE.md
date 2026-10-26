# Android alpha.1: выпуск и приёмка

Статус: alpha.1 собрана на Windows 21.10.2026; реальное устройство не подключено.
Application ID: io.kaiden.orion.android. Версия: 0.1.0 / code 1.
Целевое устройство: OPPO Reno8 5G. Реальная ОС/ColorOS пока не установлена.

## Состав
Локальные задачи/заметки, поиск, редактор, черновик, архив заметок,
сохраняемая очередь операций и LAN-профиль без сетевой передачи.

## Сборка
JDK 21, Node 22, pnpm 9.12, Android SDK согласно android/variables.gradle.
Из корня: pnpm install --frozen-lockfile.
pnpm --filter @orion/android build
pnpm --filter @orion/android android:sync
В apps/android/android: gradlew.bat assembleDebug assembleRelease lintDebug.
Debug APK подписывается стандартным тестовым ключом Android.
Release unsigned можно подписать собственным ключом владельца через apksigner;
ключ и пароли не должны попадать в Git. Не выдавать debug за production release.

## Ручная приёмка OPPO
Установка APK; авиарежим; создание/редактирование задач и заметок; длинный
русский текст; перезапуск и принудительное закрытие; системный Back;
клавиатура; тёмная/светлая тема; увеличенный системный шрифт; архив/возврат;
обновление APK поверх установленного с сохранением данных.
Удаление приложения удаляет его локальную БД.

## Условие следующего релиза
Нативный TLS pairing и Keystore, реальная LAN-приёмка с desktop, экспорт
резервной копии, миграции локального формата и разрешение конфликтов.

## Проверено 21.10.2026

Основа ветки: bae18a1be35c9b26cf42f6727c6820ddefa38ff7.
Ветка: feature/android-foundation-20261021. Исходники релиза определяет
Git-тег v0.1.0-android-alpha.1.

| Проверка | Результат |
|---|---|
| Android assembleDebug / assembleRelease / lintDebug | PASS; app lint: 0 ошибок, 25 предупреждений (шаблонные ресурсы, обновления зависимостей) |
| apksigner verify | PASS, APK Signature Scheme v2, один Android Debug signer |
| Package / SDK | io.kaiden.orion.android; versionCode 1; 0.1.0; minSdk 24; targetSdk 36 |
| Полная проверка типов | PASS после pnpm db:generate |
| Полные unit tests | PASS: 187 файлов, 1451 тест, включая 8 новых тестов хранилища |
| ESLint | PASS: 0 ошибок, 29 предупреждений существующего кода |
| Architecture / plugin contracts / module docs | PASS; plugin contracts: 11 тестов |
| Полная сборка pnpm build | PASS, API и 52 страницы web; Android bundle также собран |
| Синтетический browser smoke | PASS: создание, offline completion, перезапуск, черновик, Markdown, архив/возврат, поиск, профиль LAN, Back, 320px; без page errors |
| OPPO Reno8 5G / эмулятор / SQLite runtime | NOT RUN: adb devices пуст; эмулятор не установлен |
| Реальный LAN, TLS pairing, синхронизация | NOT IMPLEMENTED в alpha.1 |
| Интеграционные тесты PostgreSQL/RLS и Windows installer | NOT RUN; серверные исходники/схема не менялись |
| GitHub Actions | Workflow добавлен; локальные результаты не означают успешный удалённый CI |

Первый общий запуск тестов и типов в чистой рабочей копии не прошёл из-за
отсутствия сгенерированного Prisma Client. После pnpm db:generate проверки
повторены и прошли; БД и миграции не запускались. Vitest 5 на установленном
Node 22.14 дал ошибку internal package import; проверки выполнены на Node 24.19.

Устанавливаемый файл: KAIDEN-Orion-0.1.0-android-alpha.1.apk (4 587 991 байт).
SHA-256: 72b9a553c090ef2e897747bb70892c864630f4dc0eb6bfecfafff9c1f45f902d.
Отдельно собран unsigned release APK для подписания ключом владельца.
Debug APK — предварительная сборка для знакомства, не production подпись.

Основные новые файлы: apps/android (мобильный shell, формы, адаптеры,
Android-проект и SQLite bridge); packages/mobile-core (локальный repository,
операции из общих контрактов и тесты); scripts/android-smoke.mjs;
.github/workflows/android.yml; docs/android. README.md и STATUS.md дают
точку входа; ESLint исключает скопированные Capacitor bundles;
pnpm-lock.yaml дополнен зависимостями Android. API/desktop/core/shared-types
исходники и Prisma-миграции сохранены без изменений.
