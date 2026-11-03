# Windows Beta 37 — интеграция PR #96, 03.11.2026

Статус: опубликован GitHub prerelease beta.37 и установлен локально. Source `821e694370f44485442edcdfe83de23709b1a8d8`. Публикация beta.37 и локальная установка разрешены владельцем в чате. Master не изменяется.

## Что перенесено

PR #96 / `feat/agent-connect-owner-control-20261103`, HEAD `84bb0dc80b0fcb6164febb2d54b3810bea30a941`, интегрирован merge commit `790e900` в `codex/orion-dev-stabilization-20261102`. Предыдущие ORION DEV и scope ceiling/serialized policy edits beta.36 сохранены. XLSX PR #94 не включён.

Выбор роли и срока токена (1–36500 дней / бессрочно), изменение срока с аудитом, только текущий workspace owner для admin, проверка owner при авторизации admin, node-owner/loopback/JSON guard для автоустановки клиента. Секрет вынесен в token-file; REST handshake выполняется до изменения файлов и отзыва старого токена. API-проверка явно отделена от MCP readiness. Platform API 1.13.0 / AgentGateway 1.1.0; схемы БД не менялись. [ADR-0047](../docs/adr/ADR-0047-agent-connection-owner-control.md).

## Исправлено при локальном review

- Одновременные установки одного клиента больше не перезаписывают результат друг друга внутри локального API. Проверяется изменение config/token-file внешней программой за время handshake; при конфликте новые credentials отзываются.
- TOML проверяется парсером, а остальные настройки сравниваются семантически. Повреждённые/неподдерживаемые layouts отклоняются, другие MCP-серверы сохраняются.
- При ошибке записи восстанавливается прежний token-file, новый токен отзывается; временные файлы очищаются. Ошибки не выводят credential.
- Путь token-file абсолютный: рабочая папка MCP-клиента не совпадает с cwd API. Это выявлено реальным browser/adapter smoke.
- Windows ACL изначально наследовали Users Modify от папки тестового профиля. Финальный код создаёт пустой временный файл, назначает явные user/SYSTEM/Administrators ACL и только затем пишет секрет. То же применяется к backup/config staging; POSIX 0600. Windows ACL проверены через native icacls/SDDL; DPAPI не заявляется.

## Проверки

Windows: 1708 unit / 220 files PASS, полный typecheck PASS, lint 0 errors / 39 прежних warnings; architecture, 11 plugin contracts, module registry/docs/platform map PASS. Full PostgreSQL на новой отдельной базе :5436: 684 PASS / 1 opt-in benchmark skip; после финальных ACL/path изменений 7 focused install/remote-policy integration PASS. Owner demotion возвращает 401; non-owner admin issuance/edit отвергается; expiry audit проверен. Рабочая база для fixtures не использовалась.

8 Chromium PASS: Claude Desktop config preservation/private token-file; Codex admin confirmation/cancel, invalid/custom/indefinite expiry, фактический запуск stdio adapter и orion_get_context из сохранённой конфигурации, 390px; прежние proposals/audit/revoke и 5 ORION DEV recovery/overview сценариев. Это реальный MCP-adapter процесс на синтетическом профиле, не утверждение о перезапуске текущего Codex-приложения владельца.

Промежуточные неуспешные прогоны сохранены: устаревший тест не раскрывал группу пространства в Settings; затем одновременный desktop export заменил Next intermediates, и проверка потеряла JS chunks (400). Недостоверный прогон остановлен, Web пересобран, повтор запущен без параллельного export. Отдельный browser smoke обнаружил относительный путь credentials; после исправления все 8 PASS. Первая NSIS-сборка `790e900` не публикуется из-за выявленного ACL-дефекта.

Локальные evidence: `tmp/orion-dev-review/beta37-{unit-release,typecheck-release,lint-release,architecture-release,agent-release-integration,integration-all,browser-release,build-release}.log`; изображения consent/result 390px в `test-results/e2e/agent-one-click-Codex-admi-2d055-launches-a-real-MCP-adapter-chromium/`. Секреты/профили/EXE в Git не добавляются.

## Финальная сборка и публикация

- Release: https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.37 . Tag указывает точно на `821e694370f44485442edcdfe83de23709b1a8d8`, isDraft=false / isPrerelease=true.
- EXE: `dist/releases/beta.37/ORION_0.1.37_x64-setup.exe`, 96 509 959 bytes. Установщик содержит все 153 migration.sql (проверен actual NSIS archive).
- SHA-256: `30b1d09b8a5bbba5a8ba1d624774b1d422bb3a187f602fcef52e757feee95900`. EXE и SHA256SUMS.txt загружены. После публикации body перечитан и проверен regex extractSha256; GitHub asset.digest/size совпадают с локальным файлом.
- Финальный full PostgreSQL regression source 821e694: 684 PASS / 1 opt-in skip на новой БД, 117 files PASS / 1 benchmark file skip. Evidence: `beta37-final-integration.log`.
- Packaged runtime source 821e694: свежий профиль, миграции, auto-install Codex admin/private token-file, REST auth, actual stdio MCP context PASS; ORION DEV import/restart/reimport без дублей PASS. Evidence: `beta37-final-packaged-result.log`. File ACL из готового пакета: явные SYSTEM/Administrators/current user, IsInherited=false; `beta37-packaged-acl.json`.
- Локальная установка поверх предыдущего кандидата: installer exit 0, установленный build.json = beta.37/821e694. Существующий профиль не резервировался по прежнему указанию владельца. API startup/auth PASS; native мастер показывает роль/срок действия; старый Orion Dev с 14 проектами сохранён. Реальные MCP-конфиги/токены не выпускались и не заменялись. Native evidence: `beta37-native-agent-wizard.png`, `beta37-native-settings-wide.png`.
- GitHub CI финального исходника: https://github.com/KeinReno/ORION/actions/runs/41649989477 . На момент отчёта typecheck/lint/architecture/contracts/unit/full integration PASS, production build выполняется. Полный CI ещё не подтверждён. Прежний run 790e900 отменён как заменённый финальным security-fix коммитом; beta.36 CI был отменён по лимиту 30min, его зелёный итог не заявляется.

Запущенный desktop оставлен на мастере подключения в существующем пространстве. После установки до запуска дождались завершения NSIS; прежняя ошибка пользователя при запуске во время замены файлов не воспроизвелась. Тестовый кластер :5436 остановлен; рабочий узел не останавливался после приёмки.

Ограничения: in-memory install lock не заявляется межпроцессным; DPAPI/OAuth/HTTP-MCP не реализованы. Независимая приёмка задач и автоматический диспетчер не объявляются завершёнными. Второй чистый физический Windows ПК не проверен. Реальные MCP-конфиги/токены пользователя при тестах не изменялись.
