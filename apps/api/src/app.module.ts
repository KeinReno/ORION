import { OpportunitiesModule } from "./opportunities/opportunities.module";
import { OpportunityExtensionsModule } from "./opportunity-extensions/opportunity-extensions.module";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "./common/prisma.module";
import { BackgroundJobsModule } from "./common/background-jobs.module";
import { ProjectAggregateModule } from "./common/project-aggregates";
import { AuthModule } from "./auth/auth.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { NotesModule } from "./notes/notes.module";
import { TasksModule } from "./tasks/tasks.module";
import { EventsModule } from "./events/events.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { FinanceModule } from "./finance/finance.module";
import { StorageModule } from "./storage/storage.module";
import { DocumentsModule } from "./documents/documents.module";
import { SyncModule } from "./sync/sync.module";
import { SettingsModule } from "./settings/settings.module";
import { SystemModule } from "./system/system.module";
import { LanModule } from "./lan/lan.module";
import { SendModule } from "./send/send.module";
import { UpdatesModule } from "./updates/updates.module";
import { FeedbackModule } from "./feedback/feedback.module";
import { ExtensionsModule } from "./extensions/extensions.module";
import { CapturesModule } from "./captures/captures.module";
import { ProjectsModule } from "./projects/projects.module";
import { SearchModule } from "./search/search.module";
import { InboxModule } from "./inbox/inbox.module";
import { TimeModule } from "./time/time.module";
import { PlanningModule } from "./planning/planning.module";
import { HabitsModule } from "./habits/habits.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { ListsModule } from "./lists/lists.module";
import { MarketsModule } from "./markets/markets.module";
import { InventoryModule } from "./inventory/inventory.module";
import { ListsInventoryModule } from "./lists-inventory/lists-inventory.module";
import { ListsFinanceModule } from "./lists-finance/lists-finance.module";
import { ContactsModule } from "./contacts/contacts.module";
import { MilestonesModule } from "./milestones/milestones.module";
import { ModulesModule } from "./modules/modules.module";
import { ActivityModule } from "./activity/activity.module";
import { AiModule } from "./ai/ai.module";
import { HealthModule } from "./health/health.module";
import { HomeModule } from "./home/home.module";
import { HomeUtilitiesModule } from "./home-utilities/home-utilities.module";
import { GoalsModule } from "./goals/goals.module";
import { PluginsModule } from "./plugins/plugins.module";
import { OverviewModule } from "./overview/overview.module";
import { SharedGrantModule } from "./shared/shared.module";
import { UsersModule } from "./users/users.module";
import { DomainEventsModule } from "./domain-events/domain-events.module";
import { GENERATED_NEST_MODULES } from "./modules-ext/modules.generated";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    BackgroundJobsModule,
    ProjectAggregateModule,
    DomainEventsModule,
    AuthModule,
    WorkspacesModule,
    ModulesModule,
    PluginsModule,
    AiModule,
    HomeModule,
    HealthModule,
    HomeUtilitiesModule,
    ActivityModule,
    GoalsModule,
    NotesModule,
    TasksModule,
    EventsModule,
    NotificationsModule,
    FinanceModule,
    StorageModule,
    DocumentsModule,
    SyncModule,
    SettingsModule,
    SystemModule,
    LanModule,
    SendModule,
    UpdatesModule,
    FeedbackModule,
    ExtensionsModule,
    ProjectsModule,
    CapturesModule,
    InboxModule,
    SearchModule,
    TimeModule,
    PlanningModule,
    HabitsModule,
    KnowledgeModule,
    ListsModule,
    OpportunitiesModule,
    OpportunityExtensionsModule,
    MarketsModule,
    InventoryModule,
    ListsInventoryModule,
    ListsFinanceModule,
    ContactsModule,
    MilestonesModule,
    OverviewModule,
    SharedGrantModule,
    UsersModule,
    // G5: модули, подключённые манифестом (modules-ext/<id>/), — список генерирует scripts/module-registry.mjs.
    ...GENERATED_NEST_MODULES
  ]
})
export class AppModule {}
