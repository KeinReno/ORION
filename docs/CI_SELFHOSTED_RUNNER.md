# Self-hosted Windows runner для ORION CI

Дата: 11.11.2026. Зачем: hosted `ci.yml` заблокирован платёжным статусом аккаунта
GitHub, а Rust/Tauri-проверки в принципе возможны только на Windows-машине с
установленным Rust. Self-hosted runner на рабочем ПК владельца закрывает обе
проблемы бесплатно.

## Одноразовая регистрация (5 минут, требует браузер владельца)

1. Открыть https://github.com/KeinReno/ORION/settings/actions/runners/new
2. Выбрать **Windows / x64**. GitHub покажет блок команд — выполнить их в
   PowerShell. Сводка (токен подставит сам GitHub в показанных командах):

   ```powershell
   mkdir C:\actions-runner; cd C:\actions-runner
   Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v2.329.0/actions-runner-win-x64-2.329.0.zip -OutFile runner.zip
   Expand-Archive runner.zip -DestinationPath .
   .\config.cmd --url https://github.com/KeinReno/ORION --token <ТОКЕН_ИЗ_UI> --labels windows --unattended
   ```

   Важно: при вопросе о labels оставить `windows` (workflow выбирает runner по
   `runs-on: [self-hosted, windows]`).
3. Установить как службу, чтобы переживал перезагрузку:

   ```powershell
   .\svc.cmd install
   .\svc.cmd start
   ```

4. Проверка: в Settings → Actions → Runners runner должен быть «Idle».
   Первый push ветки `experiment/**` или ручной запуск
   `CI (self-hosted Windows)` подтвердит работу.

## Требования к машине

- Windows 10/11 x64 (есть).
- Node 24 и pnpm ставятся самими actions (`setup-node`, `pnpm/action-setup`) —
  вручную не нужно.
- Rust ставится шагом `dtolnay/rust-toolchain@stable`; чтобы ускорить прогоны,
  можно один раз поставить rustup на машину.
- WebView2 уже есть на машине (Tauri-сборки выполнялись локально).
- Порт 5433 должен быть свободен во время прогона (локальный PostgreSQL
  поднимается скриптом `pnpm db:up` без Docker).

## Безопасность

- Репозиторий приватный — runner на нём безопасен. **Никогда не включайте
  self-hosted runner на публичном репозитории**: чужой PR получил бы выполнение
  кода на этой машине.
- Runner работает от имени пользователя Windows; секреты репозитория (если
  появятся) будут доступны его задачам — держите их минимальными.
- Рабочие каталоги runner (`C:\actions-runner\_work`) не входят в бэкапы ORION —
  это нормально, данные репозитория там только для сборки.

## Что делает workflow

`.github/workflows/ci-selfhosted.yml`: install → локальный PostgreSQL →
миграции → typecheck → lint → architecture-check → platform-map →
plugin-contract-check → unit → integration → production build → `cargo test` и
`cargo clippy -D warnings` для `orion-rust` → `cargo check` для Tauri-оболочки.
Это суперсет hosted `ci.yml` плюс Rust-проверки, которых раньше не было вообще.

## Когда вернуться на hosted CI

Если платёжный статус GitHub восстановится, hosted `ci.yml` снова начнёт
работать сам — удалять self-hosted workflow не нужно; они дополняют друг друга
( hosted = Linux/чистая среда, self-hosted = Windows + Rust).
