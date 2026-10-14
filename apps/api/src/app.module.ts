import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "./common/prisma.module";
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
import { ProjectsModule } from "./projects/projects.module";
import { SearchModule } from "./search/search.module";
import { InboxModule } from "./inbox/inbox.module";
import { TimeModule } from "./time/time.module";
import { HabitsModule } from "./habits/habits.module";
import { ListsModule } from "./lists/lists.module";
import { MarketsModule } from "./markets/markets.module";
import { InventoryModule } from "./inventory/inventory.module";
import { ListsInventoryModule } from "./lists-inventory/lists-inventory.module";
import { ContactsModule } from "./contacts/contacts.module";
import { MilestonesModule } from "./milestones/milestones.module";
import { ModulesModule } from "./modules/modules.module";
import { ActivityModule } from "./activity/activity.module";
import { AiModule } from "./ai/ai.module";
import { HomeModule } from "./home/home.module";
import { GoalsModule } from "./goals/goals.module";
import { PluginsModule } from "./plugins/plugins.module";
import { OverviewModule } from "./overview/overview.module";
import { SharedGrantModule } from "./shared/shared.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    WorkspacesModule,
    ModulesModule,
    PluginsModule,
    AiModule,
    HomeModule,
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
    ProjectsModule,
    InboxModule,
    SearchModule,
    TimeModule,
    HabitsModule,
    ListsModule,
    MarketsModule,
    InventoryModule,
    ListsInventoryModule,
    ContactsModule,
    MilestonesModule,
    OverviewModule,
    SharedGrantModule,
    UsersModule
  ]
})
export class AppModule {}
