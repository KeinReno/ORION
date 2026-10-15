# KAIDEN Orion — замена иконок, 15 октября 2026

Проект: `C:\Users\Reno\Desktop\ORION`.

## Что изменено

Утверждённое вложение сохранено без изменений в `apps/desktop/src-tauri/icon-source.png`.
SHA-256: `649bb3d18d90980fc5726176e1e5d95c17d4ee2e8c4a33471cb27c6aab95ec20`.
Из него обрезаны только внешние пустые поля; эмблема с надписью целиком помещена
без искажения пропорций в квадрат 1024×1024 (`icon-square.png`). Исходник RGB,
прозрачности нет. Чёрный фон сохранён для контраста белой надписи; PNG/ICO
подготовлены как RGBA. На 16–32 px читается силуэт эмблемы, надпись при таких
размерах не может оставаться разборчивой.

Штатный генератор Tauri пересоздал PNG, ICO, ICNS, Windows Store, Android и iOS
ресурсы из этого квадрата. Windows ICO содержит 16, 24, 32, 48, 64, 256 px.
Для favicon создан отдельный ICO с 16, 20, 24, 32, 40, 48, 64, 128, 256 px.
Добавлены веб-иконки 16, 32, 48, 180, 192, 512 px и общий логотип 256 px.

Общий компонент KaidenLogo используется на экранах входа, регистрации,
пространств, учётной записи и в боковой панели рабочего окна. Значки действий,
аватары людей и буквенные обозначения пространств сохраняют свой смысл.
Favicon подключён в общей metadata Next.js и в отдельном браузерном popout.
Установщик и деинсталлятор NSIS явно используют `icons/icon.ico`.
Ярлык `ORION.lnk` уже настроен на этот же ICO; его сценарий менять не требуется.

## Проверка

- Работающий Tauri dev автоматически пересобрал и перезапустил оболочку.
  Новый `apps/desktop/src-tauri/target/debug/orion-desktop.exe` создан
  15.10.2026 в 02:14 по Москве. При проверке его ресурсов все шесть RT_ICON
  побайтно совпали с новым ICO. Доказательство: `icon-verification.json`,
  извлечённый значок: `running-exe-icon.ico`.
- В браузере на localhost:3010 проверены загрузка нового логотипа (naturalWidth
  256) на /login и /register, ссылки favicon/apple-touch-icon и ответы HTTP 200
  для всех девяти ресурсов. Ширины проверки: 1280 и 390 px.
- Автоматические полноэкранные снимки не использованы как визуальное
  подтверждение: входная Framer Motion анимация в headless-сеансе оставляла
  родительский контейнер с opacity:0. Исходники анимации не менялись.
  Внешний вид набора размеров проверен по `icon-sizes-preview.png`.
- Линтер на всех семи затронутых TSX-файлах: успешно.
- Unit tests: 90 файлов, 707 тестов успешно.
- Architecture check: успешно. Plugin contracts: 10 тестов успешно.
- Общий lint заблокирован существующим no-control-regex в
  `apps/web/lib/note-export.ts:6`; также имеются два предупреждения hooks.
- Общий typecheck заблокирован существующими несовпадениями типов данных списков
  в shared-types. Эти файлы уже изменялись до начала работы.
- build:desktop-export: компиляция успешна, затем проверка типов остановлена в
  `apps/web/panels/home/home-payments.tsx:65`: отсутствует обязательный
  `counterparty`. Это не относится к изменениям логотипа.
- Новый release EXE и NSIS installer не выпущены: штатная цепочка требует
  успешного desktop-export. Существующий release/installer остался прежним.
  Проверки сборки не отключались. Визуальная проверка панели задач Windows
  и авторизованного основного окна не проводилась.

## Повторная генерация Tauri

Из корня проекта:

```powershell
corepack pnpm --filter @orion/desktop tauri icon src-tauri/icon-square.png --ios-color '#000000'
```

После устранения посторонних ошибок сборки:

```powershell
corepack pnpm build:desktop-installer
```

## Точный список файлов этого изменения

- `apps/desktop/src-tauri/icon-source.png`
- `apps/desktop/src-tauri/icon-square.png`
- `apps/desktop/src-tauri/icons/128x128.png`
- `apps/desktop/src-tauri/icons/128x128@2x.png`
- `apps/desktop/src-tauri/icons/32x32.png`
- `apps/desktop/src-tauri/icons/64x64.png`
- `apps/desktop/src-tauri/icons/Square107x107Logo.png`
- `apps/desktop/src-tauri/icons/Square142x142Logo.png`
- `apps/desktop/src-tauri/icons/Square150x150Logo.png`
- `apps/desktop/src-tauri/icons/Square284x284Logo.png`
- `apps/desktop/src-tauri/icons/Square30x30Logo.png`
- `apps/desktop/src-tauri/icons/Square310x310Logo.png`
- `apps/desktop/src-tauri/icons/Square44x44Logo.png`
- `apps/desktop/src-tauri/icons/Square71x71Logo.png`
- `apps/desktop/src-tauri/icons/Square89x89Logo.png`
- `apps/desktop/src-tauri/icons/StoreLogo.png`
- `apps/desktop/src-tauri/icons/android/mipmap-hdpi/ic_launcher.png`
- `apps/desktop/src-tauri/icons/android/mipmap-hdpi/ic_launcher_foreground.png`
- `apps/desktop/src-tauri/icons/android/mipmap-hdpi/ic_launcher_round.png`
- `apps/desktop/src-tauri/icons/android/mipmap-mdpi/ic_launcher.png`
- `apps/desktop/src-tauri/icons/android/mipmap-mdpi/ic_launcher_foreground.png`
- `apps/desktop/src-tauri/icons/android/mipmap-mdpi/ic_launcher_round.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xhdpi/ic_launcher.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xhdpi/ic_launcher_foreground.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xhdpi/ic_launcher_round.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher_foreground.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher_round.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_foreground.png`
- `apps/desktop/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_round.png`
- `apps/desktop/src-tauri/icons/android/values/ic_launcher_background.xml`
- `apps/desktop/src-tauri/icons/icon.icns`
- `apps/desktop/src-tauri/icons/icon.ico`
- `apps/desktop/src-tauri/icons/icon.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-20x20@1x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-20x20@2x-1.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-20x20@2x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-20x20@3x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-29x29@1x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-29x29@2x-1.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-29x29@2x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-29x29@3x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-40x40@1x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-40x40@2x-1.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-40x40@2x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-40x40@3x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-512@2x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-60x60@2x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-60x60@3x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-76x76@1x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-76x76@2x.png`
- `apps/desktop/src-tauri/icons/ios/AppIcon-83.5x83.5@2x.png`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/web/app/(app)/layout.tsx`
- `apps/web/app/account/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/login/page.tsx`
- `apps/web/app/spaces/page.tsx`
- `apps/web/components/auth-shell.tsx`
- `apps/web/components/kaiden-logo.tsx`
- `apps/web/public/favicon.ico`
- `apps/web/public/kaiden-16.png`
- `apps/web/public/kaiden-180.png`
- `apps/web/public/kaiden-192.png`
- `apps/web/public/kaiden-32.png`
- `apps/web/public/kaiden-48.png`
- `apps/web/public/kaiden-512.png`
- `apps/web/public/kaiden-logo.png`
- `apps/web/public/popout.html`
- `docs/KAIDEN_BRANDING_2026-10-15.md` — этот отчёт.
