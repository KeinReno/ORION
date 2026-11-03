# Windows Beta 36 — 03.11.2026

Публикация разрешена владельцем в этом чате. Prerelease: https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.36 . Master и отдельный XLSX PR #94 не изменены.

Source: `18930a8f170642c2e12becdc8a220e75a04dc315`, ветка `codex/orion-dev-stabilization-20261102`. ORION_BUILD_TAG=`v0.1.0-windows-beta.36`; Tauri/Cargo/NSIS version `0.1.36`.

Артефакт: `dist/releases/beta.36/ORION_0.1.36_x64-setup.exe`, 96 477 875 bytes.
SHA-256: `4657605f5e0569820a6910109d1e8777edb6c6ac2d940ea74d90fdfb5f714fde`.

EXE и SHA256SUMS.txt загружены. После публикации body перечитан: regex extractSha256 извлекает тот же hash; GitHub asset.digest/size совпадают с локальным EXE. Релиз isDraft=false / isPrerelease=true. Установленный профиль владельца этим релизным проходом не менялся.

Проверки релизного commit: 1695 unit PASS; полный TypeScript PASS; lint 0 errors / 39 прежних warnings; architecture, plugin contracts (11), module registry/docs/platform map PASS. Production API/desktop export и NSIS build PASS. Packaged runtime на отдельном новом профиле: миграции/импорт/restart/reimport без дублей PASS; Windows Job Object/Habitat smoke PASS.

Локальный full PostgreSQL run на повторно использованной базе: 681 PASS, 1 FAIL, 1 opt-in skip. Outbox retry assertion получил attempts=0 вместо 1 после одного прохода dispatcher. Повтор всех 7 тестов этого файла на новой отдельной базе PASS без изменений кода. Не выдаём повтор файла за полный зелёный локальный прогон.

GitHub CI: https://github.com/KeinReno/ORION/actions/runs/41584142655 . На момент публикации install/migrations/typecheck/lint/architecture/contracts/unit/full integration/production build PASS; полный browser suite выполняется. Итог всего CI ещё не подтверждён. Для исходного UI dd6307e ранее 47 Chromium PASS и установленный native UI PASS; релиз меняет только номер установщика и документацию. Второй чистый физический Windows ПК не проверен. Возможности диспетчера агентов и независимой приёмки не объявляются готовыми.

Evidence: `tmp/orion-dev-review/beta36-{build,typecheck,unit,lint,architecture,contracts,integration,events-fresh,packaged-result}.log`, `beta36-published.json`. В репозитории не хранятся runtime, профиль, ключи или локальные .env.
