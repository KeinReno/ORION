# KAIDEN Orion Android

Независимая офлайн alpha для OPPO Reno8 5G. [Документация и ограничения](../../docs/android/README.md).
Alpha.21 (0.1.20/code21): упрощённое подключение, индикатор обмена и исправления
форм. [Результаты и приёмка](../../docs/android/RELEASE_ALPHA21.md).
Устанавливать поверх прежней версии, сохранив её данные.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @orion/android build
pnpm --filter @orion/android android:sync
cd apps/android/android
./gradlew.bat assembleDebug assembleRelease lintDebug
```

Требуются JDK 21 и Android SDK 36 (ANDROID_HOME или local.properties).
Для проверок монорепозитория используйте Node 24; установленный Node 22.14
на этой Windows-машине не смог загрузить внутренний импорт Vitest 5.
Перед общими проверками выполните pnpm db:generate (не изменяет БД).

Веб-проверка: pnpm --filter @orion/android dev; в другом терминале
node scripts/android-smoke.mjs. Она использует синтетические данные и
браузерный IndexedDB, **не подтверждает SQLite/ColorOS на телефоне**.

APK: android/app/build/outputs/apk/debug/app-debug.apk.
Это тестовая подпись. Обновления требуют того же ключа и большего versionCode;
не удаляйте приложение ради обновления, иначе потеряете его локальные записи.
Release unsigned: android/app/build/outputs/apk/release/app-release-unsigned.apk.
