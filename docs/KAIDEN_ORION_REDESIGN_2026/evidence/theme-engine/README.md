# Theme Engine — свидетельства

Снимки настоящего Settings route, без временных маршрутов:

- [Светлая Arctic](theme-engine-arctic.png)
- [Её диалог и черновик](theme-engine-arctic-dialog.png)
- [KAIDEN Precision](theme-engine-precision.png)
- [Узкий образец Precision, 390 px](theme-engine-precision-mobile.png)

`browser-evidence.json` фиксирует источник кадров. `runtime-before.json` /
`runtime-after.json` — два прохода по 7 панелям на 1280/390. `pixel-comparison.json`
содержит 16 пар: 11 совпали полностью, прочие содержат динамические значения.
Это диагностический baseline, не полная native/production visual acceptance.

Новые воспроизводимые проверки: `e2e/theme-preview.spec.ts`,
`packages/ui/src/theme-engine.test.ts`, `apps/web/lib/theme-components.test.ts`.
Существующие `theme-portals` / `theme-foundation` tests сохранены и проходят.

Тесты используют отдельную локальную БД и синтетические аккаунты; реальные
preferences не читаются и не изменяются. Preview-тесты сравнивают preferences
тестового аккаунта до/после и отслеживают отсутствие запросов записи.
