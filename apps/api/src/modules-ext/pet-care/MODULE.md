# Pet Care — образец модуля, подключённого манифестом

Питомцы (имя, вид, день рождения, профиль для ветеринара), журнал ухода (кормление, ветеринар, лекарство, прогулка) и
**дневник самочувствия** — перенос приложения MurHP (`github.com/KeinReno/murhp`). Модуль включён по умолчанию
(подробности — в [`docs/platform-api/MODULE_REGISTRY.md`](../../../../../docs/platform-api/MODULE_REGISTRY.md)).

## Дневник самочувствия (перенос MurHP)

- **Что хранится.** `PetCareDay` — одна запись на `(питомец, календарный день)`: аппетит, активность, стул, вода, число
  рвот, вес, температура, лекарства, заметка, симптомы (JSON: id, выраженность, раз, время суток). `PetCareEvent` — события,
  которые могут объяснять самочувствие (смена корма, лекарство, прививка, визит, стресс). Профиль питомца получил поля
  `breed`, `vetContact`, `chronic`, `allergies`.
- **API** (`pet-care-wellbeing.controller.ts`, маршрут `workspaces/:ws/pet-care/pets/:petId/…`): `GET days?from&to`
  (окно ≤ 800 дней, без параметров — последние 90), `PUT days/:day` (заменяет день целиком, `ON CONFLICT` по `(petId, day)`),
  `DELETE days/:day`, `GET/POST events`, `DELETE events/:id`, `POST import-murhp`.
- **Статус дня, тревоги и статистика не хранятся, а вычисляются** — одна реализация в
  `packages/shared-types/src/modules-ext/pet-care/wellbeing.ts` (`computePetDayStatus`, `computePetAlerts`,
  `computePetStats`), с тестами. Статус «авто» пересчитывается и при записи, и при чтении (`toDayDto`), чтобы смена правил
  не оставляла устаревших значений в БД; ручной статус (`statusAuto = false`) хранится как выбран.
- **«Сегодня» присылает клиент** (`petLocalDayKey()` в `apps/web/lib/pet-care-days.ts` — местный день). Серверный UTC-день
  используется только как граница окна по умолчанию. Арифметика дней (`addPetDays`/`diffPetDays`) — в UTC, без часовых поясов.
- **Импорт копии MurHP** (`parseMurhpBackup` + `PetCareWellbeingService.importMurhp`): файл «Настройки → Экспорт копии (.json)».
  Терпим к незнакомым значениям справочников (становятся пустыми), строки с нереальной датой пропускаются и считаются в
  `invalidRows`. **Идемпотентен**: день уже есть — пропускается (или заменяется при `overwrite: true`), событие сравнивается
  по содержимому, профиль дополняет только пустые поля питомца. Бэкап MurHP в формате SQLite (`.sqlite`) не поддержан — нужен `.json`.
- **Что не перенесено сознательно:** оболочка MurHP (хэш-роутер, тема, Tauri/sql.js хранилище) — ORION уже даёт всё это сам;
  графики Recharts заменены SVG (новые UI-библиотеки без запроса не добавляем).
- **Границы.** Это наблюдения владельца, не диагноз: тексты тревог нейтральные («повод показать ветеринару»), доз и лекарств
  модуль не рекомендует (см. `docs/PLATFORM_EXPANSION_2026-10-17/04_PET_CARE_CONCEPT.md`). Отчёт для ветеринара — самодостаточный
  `.html` (печать → PDF) и два CSV (по дням, по симптомам); печать самого окна ORION не используется.
- **Не сделано:** инструменты ИИ-агента для дневника (сейчас агентам доступны только список питомцев и запись ухода),
  напоминания «пора записать день», вложения (анализы, фото), офлайн-запись.

## Как добавить свой модуль по этому образцу

1. Выберите `<id>` в kebab-case (например, `plants`). Создайте каталоги:
   - `apps/api/src/modules-ext/<id>/` — `module.manifest.json`, `<id>.module.ts`, контроллер, сервис,
     `prisma/models.prisma` (модели с `workspaceId`, `@@map`, связь с `Workspace`), `prisma/migration.sql`;
   - `apps/web/modules-ext/<id>/` — панель (`export function XPanel`);
   - `packages/shared-types/src/modules-ext/<id>/index.ts` — zod-схемы (ответы без `.default`, входные — с ним);
   - `apps/api/test/modules-ext/<id>/` — интеграционный тест (CRUD, изоляция второго пользователя, 409 при выключении).
2. Заполните `module.manifest.json` по образцу из этого каталога: `catalog` (запись `MODULE_CATALOG`), `permissions`,
   `api` (Nest-модуль, `probePath`), `web.panel`, `prisma` (фрагмент, обратные поля `Workspace`, миграции),
   `data.models` (политика снапшота и класс синхронизации **каждой** модели — с причиной).
3. Миграция: таблицы + `ENABLE`/`FORCE ROW LEVEL SECURITY` + `CREATE POLICY` (шаблон — `prisma/migration.sql` здесь).
   Имя вида `ГГГГММДДЧЧММСС_имя`, правки вносите в исходник в каталоге модуля, копия в `apps/api/prisma/migrations/` генерируется.
4. `pnpm module-registry`, затем `pnpm db:generate`, `pnpm --filter @orion/api prisma:migrate:deploy`.
5. Проверьте: `pnpm typecheck && pnpm lint && pnpm test && pnpm architecture-check`, `pnpm test:integration`.

Сервис модуля соблюдает инварианты обычного модуля (CLAUDE.md): `assertMemberTx` первым, всё внутри `withUser`, DTO
собирается руками (`toPetDto`), ссылка на питомца проверяется на принадлежность этому же пространству, контроллер несёт
`@RequireModule("<id>")`. Выключение модуля не удаляет данные.

## Что трогает подключение этого модуля

Только: эти каталоги, `apps/api/prisma/migrations/20261018120000_pet_care/`, области между маркерами в
`schema.prisma` и `*.generated.ts`. Проверка: `node scripts/module-registry.mjs --check-diff <base>`.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `pet-care` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | — |
| Права (permissions) | `pet-care.pet.read`, `pet-care.pet.create`, `pet-care.pet.update`, `pet-care.pet.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `pet-care` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/pet-care` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | `20261018120000_pet_care`, `20261019150000_pet_care_wellbeing` |
| Код на сервере | `apps/api/src/modules-ext/pet-care/` |
| При выключении | Панель и API скрываются. Питомцы, записи ухода, дневник и события сохраняются и вернутся при включении. |
<!-- generated:manifest:end -->
