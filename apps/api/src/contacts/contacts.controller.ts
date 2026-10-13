import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  createContactCardInputSchema,
  updateContactCardInputSchema,
  type ContactCard,
  type CreateContactCardInput,
  type UpdateContactCardInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { ContactsService } from "./contacts.service";

@RequireModule("contacts")
@Controller("workspaces/:workspaceId/contacts")
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<ContactCard[]> {
    return this.contacts.list(user.userId, workspaceId);
  }

  @Get(":contactId")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("contactId") contactId: string): Promise<ContactCard> {
    return this.contacts.get(user.userId, workspaceId, contactId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createContactCardInputSchema)) body: CreateContactCardInput
  ): Promise<ContactCard> {
    return this.contacts.create(user.userId, workspaceId, body);
  }

  @Patch(":contactId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(updateContactCardInputSchema)) body: UpdateContactCardInput
  ): Promise<ContactCard> {
    return this.contacts.update(user.userId, workspaceId, contactId, body);
  }

  @Delete(":contactId")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("contactId") contactId: string): Promise<void> {
    await this.contacts.remove(user.userId, workspaceId, contactId);
  }
}
