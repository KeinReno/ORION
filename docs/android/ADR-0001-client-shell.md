# Android ADR-0001: оболочка первой alpha

Дата: 21.10.2026. Статус: IMPLEMENTED для разрешённого владельцем среза.
Область решения — Android-клиент; публичный серверный протокол не меняется.

## Контекст
В ANDROID_CLIENT_PLAN.md Tauri 2 был кандидатом, apps/mobile — предложением.
Android-исходников не было. Уже существуют TypeScript Task/Note, SyncOp и
публичная проекция локальных операций. Desktop требует Node/PostgreSQL runtime,
который не подходит для переноса на Android.

## Решение
apps/android: Capacitor 8 + React 18 + Vite 6; packages/mobile-core:
локальный repository поверх общих контрактов. Нативный SQLite plugin
фиксирует снимок и outbox атомарно, UI получает успех после commit.
Это позволяет проверить полезный офлайн-клиент, не изменяя desktop.

## Альтернативы и последствия
Compose/Kotlin потребовал бы дублирования или генерации существующих DTO
и новой реализации проекции. Tauri Android потребовал бы отдельной проверки
Rust/mobile toolchain; его Windows sidecar всё равно не переносится.
Capacitor сохраняет общий TypeScript и предоставляет нативные расширения,
но требует проверки WebView, клавиатуры, TalkBack и жизненного цикла ColorOS.
Нативный TLS transport и Keystore ещё нужны для LAN; alpha не объявляет
profile сохранение готовым подключением.

Основание выбора и требования проверены по официальной
[документации Capacitor](https://capacitorjs.com/docs/getting-started/environment-setup)
и фактическим пакетам @capacitor/android 8.5.3.
Пересмотр решения возможен после физической приёмки; формат SyncOp остаётся
существующим протоколом, а локальный snapshot имеет собственную версию.
