import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";

/** Module «Контакты» — one controller/service pair over the `contacts` table shared with «Дом». */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ContactsController],
  providers: [ContactsService]
})
export class ContactsModule {}
