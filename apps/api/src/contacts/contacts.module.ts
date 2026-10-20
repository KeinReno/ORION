import { AgentCoreModule } from "../ai/agent-core.module";
import { ContactsAgentController } from "./contacts.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ContactRemindersService } from "./contact-reminders.service";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { ContactsSearchProvider } from "./contacts-search.provider";

/**
 * Module «Контакты» — one controller/service pair over the `contacts` table shared with «Дом»,
 * plus the hourly producer of birthday / «пора связаться» notifications.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, NotificationsModule, SearchRegistryModule, AgentCoreModule],
  controllers: [ContactsController, ContactsAgentController],
  providers: [ContactsService, ContactRemindersService, ContactsSearchProvider]
})
export class ContactsModule {}
