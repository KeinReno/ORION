import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  bulkContactsInputSchema,
  createContactCardInputSchema,
  createContactInteractionInputSchema,
  createContactRelationInputSchema,
  importContactsInputSchema,
  mergeContactsInputSchema,
  updateContactCardInputSchema,
  type BulkContactsInput,
  type BulkContactsResult,
  type ContactCard,
  type ContactInteraction,
  type ContactRelation,
  type CreateContactCardInput,
  type CreateContactInteractionInput,
  type CreateContactRelationInput,
  type ImportContactsInput,
  type ImportContactsResult,
  type MergeContactsInput,
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

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createContactCardInputSchema)) body: CreateContactCardInput
  ): Promise<ContactCard> {
    return this.contacts.create(user.userId, workspaceId, body);
  }

  @Post("bulk")
  @HttpCode(200)
  bulk(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(bulkContactsInputSchema)) body: BulkContactsInput
  ): Promise<BulkContactsResult> {
    return this.contacts.bulk(user.userId, workspaceId, body);
  }

  @Post("import")
  @HttpCode(200)
  importMany(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(importContactsInputSchema)) body: ImportContactsInput
  ): Promise<ImportContactsResult> {
    return this.contacts.importMany(user.userId, workspaceId, body);
  }

  @Get(":contactId")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("contactId") contactId: string): Promise<ContactCard> {
    return this.contacts.get(user.userId, workspaceId, contactId);
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

  @Post(":contactId/merge")
  @HttpCode(200)
  merge(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(mergeContactsInputSchema)) body: MergeContactsInput
  ): Promise<ContactCard> {
    return this.contacts.merge(user.userId, workspaceId, contactId, body);
  }

  @Get(":contactId/interactions")
  listInteractions(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("contactId") contactId: string): Promise<ContactInteraction[]> {
    return this.contacts.listInteractions(user.userId, workspaceId, contactId);
  }

  @Post(":contactId/interactions")
  createInteraction(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(createContactInteractionInputSchema)) body: CreateContactInteractionInput
  ): Promise<ContactInteraction> {
    return this.contacts.createInteraction(user.userId, workspaceId, contactId, body);
  }

  @Delete(":contactId/interactions/:interactionId")
  @HttpCode(204)
  async removeInteraction(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Param("interactionId") interactionId: string
  ): Promise<void> {
    await this.contacts.removeInteraction(user.userId, workspaceId, contactId, interactionId);
  }

  @Get(":contactId/relations")
  listRelations(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("contactId") contactId: string): Promise<ContactRelation[]> {
    return this.contacts.listRelations(user.userId, workspaceId, contactId);
  }

  @Post(":contactId/relations")
  createRelation(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(createContactRelationInputSchema)) body: CreateContactRelationInput
  ): Promise<ContactRelation> {
    return this.contacts.createRelation(user.userId, workspaceId, contactId, body);
  }

  @Delete(":contactId/relations/:relationId")
  @HttpCode(204)
  async removeRelation(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Param("relationId") relationId: string
  ): Promise<void> {
    await this.contacts.removeRelation(user.userId, workspaceId, contactId, relationId);
  }
}
