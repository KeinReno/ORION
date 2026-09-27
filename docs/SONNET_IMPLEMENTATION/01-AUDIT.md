# Аудит текущего состояния

## Метод и достоверность

Исследованы README, CLAUDE, история PLAN, документы UI/UX и модулей, Prisma-схема, реестры модулей/плагинов/панелей, ключевые backend-сервисы, hooks, оболочка и выборочные панели. Graft-инструменты в этой сессии не доступны; использован прямой поиск по исходникам. Это выборочный инженерный аудит, не доказательство отсутствия остальных дефектов.

На 2026-09-21:

| Проверка | Результат |
|---|---|
| `corepack pnpm typecheck` | PASS, все перечисленные пакеты |
| `corepack pnpm test` | PASS: 13 файлов, 135 тестов |
| `corepack pnpm lint` | 0 ошибок, 3 warning |
| Интеграционные тесты | Не запускались: не подготовлена отдельная тестовая БД |
| `corepack pnpm build` | PASS: API TypeScript + production Next build, 26 страниц |
| `corepack pnpm --filter @orion/web build:desktop` | FAIL: `/invite/[token]` не имеет generateStaticParams, несовместим с output:export |
| Native Tauri build | Не запускался; frontend export уже блокирует поставку |
| Браузер | Открыт реальный `/login` локального Next dev; backend недоступен |
| Панели после входа | Изучены по коду; визуальная проверка populated-состояний не выполнена |

Предупреждения lint: `CalendarPanel.tsx:320` (зависимости effect), `DocumentsPanel.tsx:225` (зависимость requestMove), `scripts/seed-demo-workspace.mjs:561` (неиспользуемый tBacklog). Номера относятся к снимку аудита; находить функции по символам, не слепо по строкам.

## Сильные стороны — сохранить

- Модульный монолит и зеркальные слои контракт → клиент → hooks → панель.
- Двойной барьер доступа: membership и PostgreSQL FORCE RLS.
- Проверки cross-workspace ссылок: RLS сам по себе не запрещает смешать две доступные пользователю рабочие области.
- Хранение финансов в minor units; вычисляемые итоги; append-only движения склада.
- Повторения календаря, история заметок, версии документов, фоновые задачи уже имеют реальную реализацию.
- Модули выключаются без удаления данных. Тяжёлые панели/просмотрщики загружаются лениво.
- CI имеет интеграционную проверку RLS. Интеграционный файл гораздо шире старого описания в CLAUDE.
- Workbench, panel-bus, собственные UI-примитивы уже являются осознанными решениями проекта.

## Реестр находок

### A01 · P0 · Ограниченные модули доступны через агрегаторы — подтверждено статическим анализом

`apps/api/src/modules/modules.service.ts`: `assertEnabledTx` учитывает роль и restrictedModules, но `enabledSetTx(tx, workspaceId)` учитывает только disabledModules. `search/search.service.ts:search` и `projects/projects.service.ts:get/toDtos` используют второй метод. RLS разрешает строки члену пространства, поэтому не восполняет этот пропуск.

Последствие: запрет прямого `/finance` не гарантирует сокрытия названий/сумм/активности через поиск и проект. `SearchService.entityTitle/listLinks` также проверяют пространство, но не доступность домена. Это необходимо воспроизвести интеграционным тестом, а не только спрятать поля React.

Минимальная правка: единая actor-aware policy для direct API, aggregate API, links, exports и уведомлений. См. S01. Продуктовое правило: `rule/name-object-scope-consequence`, `rule/cover-reachable-states`.

### A02 · P0 · Backup/restore допускают обычного участника — подтверждено по коду

`apps/api/src/sync/sync.service.ts`: операции конфигурации и восстановления используют `assertMemberTx`, а не owner-only policy. Контроллер защищён JWT; подтверждение workspaceId не является проверкой роли.

Последствие: участник может иметь доступ к снимку всех предметных данных и разрушительному восстановлению. Область запрета должна включать настройку remote, preview, чтение/list/export backup, запуск и применение restore. См. S02. Правила: `rule/name-object-scope-consequence`, `rule/destructive-proportional`.

### A03 · P0 · Снимок неполон относительно Prisma-схемы — подтверждено по реестру

`apps/api/src/sync/snapshot.service.ts:SNAPSHOT_MODELS` включает lists, habits, time, но отсутствуют inventoryItems, inventoryMovements, milestones, milestoneDependencies, documentVersions и documentAnnotations. `apply` очищает перечисленные родительские таблицы, что может каскадно удалить не включённых детей. Task.milestoneId создаёт дополнительный риск нарушения FK при вставке. Фактический исход зависит от данных; обязателен restore-тест.

`SyncService.backup` шифрует JSON строк, но не включает содержимое файлов. Название «полная резервная копия» без такого уточнения недостоверно. `SNAPSHOT_VERSION=1`, отсутствующие таблицы превращаются в пустые массивы; `skipDuplicates` может скрыть неполное восстановление. См. S03–S04.

### A04 · P0 для сетевого режима · Локальная модель входа не разделена с серверной

`auth.controller.ts:GET accounts` без JWT; `AuthService.listAccounts` выдаёт имена, email, пространства всех учётных записей. Поддержан четырёхзначный PIN. `main.ts` вызывает `app.listen(port)` без явного loopback host. В просмотренных bootstrap/auth-файлах нет ограничителя попыток входа; проверить весь стек перед окончательным выводом.

Это приемлемый замысел локального селектора пользователя, но не безопасный контракт для общего сетевого сервера. Не считать CORS сетевой изоляцией. См. S05. Не публиковать такой сервер наружу до разделения режимов.

### A05 · P1 · Командная модель времени и уведомлений отсутствует

`TimeService.running/start/stop` ищут таймер по workspaceId; уникальный индекс разрешает один running timer на пространство. TimeEntry не задаёт исполнителя. `Notification` имеет общий readAt без recipientId; `NotificationPolicyService` читает настройки владельца. Это текущие намеренные решения, а не случайные ошибки, но они противоречат новому равноправному командному сценарию. См. S06–S07.

### A06 · P1 · Ошибка загрузки аккаунтов выглядит как отсутствие пользователей

`apps/web/app/login/page.tsx`: `const list = accounts.data ?? []`. В реальном браузере при недоступном API показано «Пока никого нет — создайте первую учётку». Требуются отдельные loading/error/empty и retry. Правила: `rule/cover-reachable-states`, `rule/error-states-recovery`. См. S08.

### A07 · P1 · Переход к ещё не смонтированной панели может потерять выбранную сущность

`apps/web/lib/panel-bus.ts:makeFocusChannel`: вызывает openPanel, затем синхронно существующих listeners. Подписка появляется в useEffect; панели dynamic/lazy. В канале нет replay pending intent, в отличие от отдельного lastTasksProject. Статически обнаруженное окно гонки; воспроизвести холодным открытием результата поиска. См. S09. Правило `rule/preserve-mental-model`.

### A08 · P1 · «Сегодня» может остаться на вчерашнем дне

`DashboardPanel.tsx`: dayRange вычисляется useMemo с пустыми зависимостями; partitionOpenTasks/partitionWeekReview зависят от tasks, а не смены дня. Workbench сохраняет панели смонтированными. После полуночи и возвращения из sleep диапазон календаря может быть старым. См. S10.

### A09 · P1 · Совместное редактирование требует защиты от потери изменений

История заметок и автосохранение существуют. В просмотренном пути обновления не найден compare-and-swap по revision/version. История не предотвращает last-write-wins. Это риск, требующий воспроизведения двумя клиентами. См. S11.

### A10 · P2 · Двойное уменьшение шрифта compact

`globals.css`: root 16→14px одновременно с body 0.9375→0.875rem: фактически 15→12.25px. Label 13→10.5px. Это вычисление из CSS, не измерение всех rendered controls. Для рабочего инструмента такая плотность снижает читаемость. Уменьшать прежде всего отступы и высоты строк. См. S12.

### A11 · P1/P2 · Ограничение выдачи времени может исказить клиентские отчёты

`TimeService.list`: take:500 без cursor/hasMore. Проверить все потребители summary: сумма первых 500 строк не должна называться итогом за период. Серверные агрегаты считать независимо от pagination. См. S15.

### A12 · P1 для сетевого режима · Неполная защита исходящих календарных URL

`calendar-connections.service.ts:validateRemoteUrl` проверяет hostname строковыми шаблонами; fetch следует redirect по умолчанию, response.text читает тело целиком. DNS/resolved address, перенаправления и лимит тела требуют проверки/доработки. Это статический риск SSRF/ресурсного истощения, не доказанная атака. См. S05/S18.

### A13 · P2 · Старые документы отстают от кода

UI_UX_DESIGN предлагает semantic tokens и AutosaveStatus, которые уже существуют. CLAUDE описывает некоторые schemas как reserved, хотя версии документов реализованы и имеют integration test. README не перечисляет все новые модули. Агент должен сначала проверять реализацию, иначе повторно строит сделанное. См. S00/S20.

### A14 · ПРОВЕРИТЬ · Жизненный цикл доступа и кэша

Проверить logout/login другим пользователем, смену пространства, revoke membership, выключение/ограничение модуля при открытой панели. `use-active-workspace.ts` использует общий localStorage key и внутреннюю подписку; listener browser storage в просмотренном файле отсутствует. Layout также сохраняется общим ключом. Это не доказательство утечки, а перечень сценариев обязательной проверки.

### A15 · P1 · Автосохранение может пропустить последнее изменение при медленном запросе

`note-editor.tsx:runSave` возвращает управление, если savingRef=true. Effect зависит только от debouncedSnapshot. Сценарий: сохранить A, пока запрос идёт набрать B, дождаться debounce B до завершения A; вызов B пропускается, завершение A не меняет debouncedSnapshot и не запускает повторную отправку. Код оставляет dirty B, но без автоматического drain. `void runSave` также требует обработки rejection. Это статически выявленное окно, воспроизвести тестом с управляемым promise. S11 должен включать trailing save, а не только version field.

### A16 · P1 · Повторяющиеся финансовые операции не защищены от двух одновременных cron

`finance/recurring/recurring-checker.service.ts:runCheck` сначала получает due rules, затем создаёт операцию и обновляет nextRunAt в отдельной транзакции для каждой ранее прочитанной rule. Нет recheck под lock или уникального occurrence key в этом пути. Два запуска могут взять одну дату и создать две проводки. Транзакция гарантирует create+advance вместе, но не уникальность occurrence. Воспроизвести concurrent runCheck, исправить S21.

### A17 · P1 · Ошибка session query скрывается как отсутствие входа

`packages/core-react/src/use-auth.ts:useSession` ловит все ошибки, очищает токен лишь при 401 (это правильно), но для network/500 тоже возвращает null. Внешний контракт не выдаёт error/offline состояние; layout может перенаправить на login, хотя сессия потенциально действительна. S08 включает различение unauthenticated и session-unavailable, U10 проверяет сохранность dirty editor.

### A18 · P2 · Измеренный стартовый JS входа велик относительно функции экрана

Production build 2026-09-21: `/login` First Load JS 495 kB, `/register` 495 kB, `/spaces` 495 kB; общий shared baseline 88.4 kB, `/panel/[panelId]` 615 kB. Это метрика build output, не Lighthouse/реальное время загрузки. Проверить import graph `packages/ui/src/index.ts`, Providers/PreferencesEffect и auth shell; нельзя заранее утверждать, что виновата конкретная библиотека. В S15 добавить измерение chunk composition и lazy boundaries, сохранив работу SSR/client boundaries.

### A19 · P2 · Очередь Inbox ограничена без сигнала полноты

`InboxService.list`: take=250 для текущих, take=100 для history; возвращается обычный массив. Dashboard/layout считают inboxCount по length. При >250 входящих число может означать только загруженную часть, хотя выглядит как общий count. S15 должен охватить inbox count/page contract наряду с time/finance.

### A20 · P0 для desktop release · Static export не собирается — воспроизведено

Команда `corepack pnpm --filter @orion/web build:desktop` завершилась exit 1 после успешной компиляции: `Page "/invite/[token]" is missing "generateStaticParams()" so it cannot be used with "output: export" config.` Web production build проходит, поэтому общий `pnpm build` этот разрыв не ловит.

`apps/web/app/invite/[token]/page.tsx` — client component с useParams. Токены создаются после сборки (`InvitesService.create`), перечислить их build-time нельзя. Нужна static-compatible entry page и миграция acceptUrl; не фиктивный generateStaticParams и не отмена static export Tauri. S22. Ограничение подтверждено [официальной документацией Next.js 14](https://nextjs.org/docs/14/app/building-your-application/deploying/static-exports#unsupported-features).

Дополнительно: ссылки Войти/Зарегистрироваться не сохраняют return-to invite; после login путь уходит в spaces. Сохранение invite intent входит в S22. Текущие network lookup ошибки не должны все называться «Приглашение не найдено».

## Не выдавать предположения за факты

Не утверждать, что весь UI недоступен с клавиатуры, файлы небезопасны, тесты отсутствуют или бэкап всегда падает. Эти обобщения не доказаны. Подтверждать каждую правку конкретным сценарием и тестом. Архитектурные и security-решения вне реестра product-design отмечены как coverage gap; продуктовые rule IDs не являются технической спецификацией безопасности.
