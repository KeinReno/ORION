# Межмодульные SDK: завершение 17 исключений

Реализовано по [ADR-0034](../adr/ADR-0034-module-boundary-completion.md).
Integration API **1.8.0**, Platform API **1.9.0**. Эти изменения аддитивны.
Карта исходников для агентов: [capabilities.generated.json](capabilities.generated.json).

| Потребитель | Контракты владельцев | Смысл |
|---|---|---|
| Goals | ProjectCatalog, ProjectReferences, GoalTaskReader, GoalMilestoneReader | Прогресс проектов, история задач, блокировки, вехи |
| Home Utilities | HomeUtilityReferences, FinanceExpenseReader | Дом/счётчик, оплаченные расходы |
| Overview | TaskOverviewReader, FinanceOverviewReader | Назначенные задачи и активные балансы |
| Markets | InvestmentJournal | Журнал сделок и атомарная явная комиссия |
| Notes attachments | DocumentAttachmentStore | Метаданные пакетами и единое файловое хранилище |
| Search / AI / Captures | TaskOperations, NoteOperations, EventOperations | Канонические команды и создание внутри исходного tx |
| Captures / Projects | ProjectReferences, TaskIntegrationReader, GoalReferences, HomeReferences, FinanceAnchorReferences, ContactReferences, CaptureOperations | Якоря и старые проектные маршруты |
| Activity / Home | TaskJournalReader, AgentJournalReader | Лента без прямого чтения чужого журнала |
| Lists restore | InventoryReferences, TransactionReferences | Проверка ссылок без загрузки соседнего модуля |
| Lists Finance | ListExpenseCommands, FinanceExpenseWriter | Блокировка пунктов и один расход |
| Lists Inventory | ListShoppingCommands, InventoryShoppingCommands | Идемпотентный приход и пополнение |
| Home | TaskHomeLinks, ListHomeLinks, InventoryHomeLinks, ObligationHomeLinks, HomeContactCommands, TaskTimeReader | Привязки, контакты и вклад участников |
| Agent Tokens / Jobs / Gateway | ProjectAgentReader, NoteAgentReferences, EventAgentReferences, TaskProposalReader, InboxAgentOperations, SearchOperations, AgentDraftOperations | Project fence, превью/CAS, захват, связи и черновики |

## Правила использования

- Импортировать контракты и их Nest-модули из `apps/api/src/<owner>/public`.
  Контракт не даёт дополнительных прав и не включает соседний модуль.
- `*Tx` принимает существующий `Prisma.TransactionClient`: не открывает новую
  транзакцию и не повышает роль. Membership/module/scope policy остаётся у caller,
  а обычные пользовательские CRUD-операции сохраняют свои собственные проверки.
- Все запросы ограничены пространством; RLS остаётся включённым. Ссылки на
  архивные объекты и выключенных соседей сохраняют политику до переноса.
- Не передавать Prisma where/select/delegate через SDK: методы описывают
  предметное действие или фиксированную проекцию, реализация `.service.ts` у владельца.
- Команды списков, склада, расходов и создания/связывания работают в одном tx.
  Уведомления отправляются только после commit, как раньше.
- Shared implementations экспортируются владельцу для его контроллеров;
  потребитель использует абстрактный контракт. SDK не импортирует полный доменный
  Nest-модуль, его контроллеры, cron и регистрацию агрегатов/поисковых провайдеров.
- Snapshots агентских предложений содержат только поля существующего preview,
  revision/updatedAt и readOnly; приватность заметок продолжает обеспечивать RLS.

Схема и сохранённые данные не менялись. Проверки и границы фактической приёмки:
[отчёт](../MODULE_BOUNDARY_COMPLETION.md).

`HomeReferences.assertTx` сохраняет прежний ответ 400 при создании сущностей с
homeId, а `existsTx` позволяет caller сохранить свою 404-политику. Внутреннего
home-refs.util.ts больше нет. Architecture-check отклоняет непубличные helper-импорты
с запросами чужого домена; public-контракты владельцев остаются явной границей.
