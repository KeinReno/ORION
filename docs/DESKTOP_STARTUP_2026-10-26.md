# Отзывчивый запуск Windows — 26.10.2026

Класс: implementation report. База: `f6aaeaa` (PR #76). Реализация в ветке
`codex/desktop-responsive-startup`. Текущий факт определяется кодом и STATUS.md.

## Причина и изменение

Release-shell вызывал `start_local_runtime()` синхронно в Tauri setup, до создания
основного WebView. Health-проверки и ожидание Node/PostgreSQL занимали UI-поток до
360 секунд. Windows в этот момент могла показывать «Не отвечает».

Теперь setup создаёт основное окно и возвращает управление. Runtime запускается
отдельным потоком. Встроенная страница `/__orion_startup` доступна до появления
runtime marker и до запуска React/API. Она использует существующий знак KAIDEN,
графитовый фон и золотой акцент; не загружает шрифты или другие внешние ресурсы.
Этапы подготовки, подключения БД, миграций и сервера приходят из launcher;
проценты не выдумываются. После health `database=ok` открывается штатный клиент
с прежним origin/storage. Ошибка остаётся в отзывчивом окне, с причиной и путём к
журналу. Deep links ждут открытия основного клиента. Таймаут в сообщении исправлен
с 180 на фактические 360 секунд.

При проверке обнаружена и исправлена несовместимость CSP-хешей многострочного
inline JS с CRLF: HTML-парсер нормализует переносы до проверки CSP. Политика
сохраняет хеши и не разрешает `unsafe-inline` для скриптов. HTML и встроенный
логотип включены в fingerprint оболочки вместе с Rust-исходниками.

Это исправление блокировки UI, а не доказанное сокращение времени холодного
старта API. Замер на реальной установке нужен отдельно.

## Проверки

- Установленный beta23: путь `LocalAppData/ORION/orion-desktop.exe`, runtime tag
  `v0.1.0-windows-beta.23`, `/updates/status` подтверждает beta23,
  `/system/health` — `status=ok`, `database=ok`.
- Полный unit-набор: 1501 passed / 191 files; typecheck, architecture и 11 plugin
  contracts passed. Runtime payload suite: 18 passed.
- Rust: 5 tests passed, включая newline/CSP regression; release cargo check passed.
- Native WebView2 startup rehearsal: success и failure passed. Оба сценария
  используют отдельный `com.orion.startup-smoke`, синтетические состояния,
  временную страницу, без реального launcher, учётных данных или БД. Проверены
  загрузка логотипа, продолжающиеся requestAnimationFrame во время ожидания,
  смена этапов, переход только после ready, ошибка и прекращение aria-busy.
- Начальный экран и ошибка просмотрены в настоящем нативном окне 1000×700.
- Impeccable detector запускался в degraded regex mode (без HTML parser modules).
  Предупреждение marquee относится к намеренному indeterminate-индикатору, а не
  движущемуся тексту. Reduced-motion отключает движение. Это не полный a11y-аудит.

Команды: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`,
`cargo check --release --manifest-path apps/desktop/src-tauri/Cargo.toml`,
`pnpm exec vitest run --maxWorkers=2 --testTimeout=30000`,
`pnpm exec vitest run scripts/runtime-payload.test.mjs`, `pnpm typecheck`,
`pnpm architecture-check`, `pnpm plugin-contract-check`.

Нативный стенд: собрать debug Tauri с абсолютным `--config` пути
`scripts/startup-smoke.config.json`, затем `node scripts/native-startup-smoke.mjs`.
Отчёт: ignored `tmp/native-startup-smoke.json`. `--inspect` оставляет контрольную
ошибку на 45 секунд для визуальной проверки; завершается только свой процесс.

## Выпуск и границы

Изменены Rust и immutable launcher: требуется **полный установщик**, payload для
beta23 эту правку доставить не может. Пользовательские данные не мигрируются
этой правкой. Сохранены остальные изменения master, включая закрытие 17
межмодульных исключений.

Этот отчёт не подтверждает установку нового NSIS, обновление личного профиля,
полный реальный payload update/rollback, два физических ПК или Android. Известное
ограничение GitHub Actions billing не заменяется утверждением об успешном CI.
