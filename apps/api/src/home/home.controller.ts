import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  attachToHomeInputSchema,
  createContactInputSchema,
  createHomeInputSchema,
  createMeterInputSchema,
  createMeterReadingInputSchema,
  updateContactInputSchema,
  updateHomeInputSchema,
  updateMeterInputSchema,
  type ActivityEntry,
  type AttachToHomeInput,
  type Contact,
  type CreateContactInput,
  type CreateHomeInput,
  type CreateMeterInput,
  type CreateMeterReadingInput,
  type Home,
  type HomeOverview,
  type Meter,
  type UpdateContactInput,
  type UpdateHomeInput,
  type UpdateMeterInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { HomeService } from "./home.service";

@RequireModule("home")
@Controller("workspaces/:workspaceId/homes")
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("archived") archived?: string): Promise<Home[]> {
    return this.home.list(user.userId, workspaceId, archived === "1" || archived === "true");
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createHomeInputSchema)) body: CreateHomeInput
  ): Promise<Home> {
    return this.home.create(user.userId, workspaceId, body);
  }

  @Get(":homeId/overview")
  overview(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("homeId") homeId: string): Promise<HomeOverview> {
    return this.home.overview(user.userId, workspaceId, homeId);
  }

  @Get(":homeId/activity")
  activity(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("homeId") homeId: string): Promise<ActivityEntry[]> {
    return this.home.activity(user.userId, workspaceId, homeId);
  }

  @Patch(":homeId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Body(new ZodValidationPipe(updateHomeInputSchema)) body: UpdateHomeInput
  ): Promise<Home> {
    return this.home.update(user.userId, workspaceId, homeId, body);
  }

  @Delete(":homeId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("homeId") homeId: string): Promise<void> {
    return this.home.remove(user.userId, workspaceId, homeId);
  }

  @Post(":homeId/attach")
  @HttpCode(204)
  attach(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Body(new ZodValidationPipe(attachToHomeInputSchema)) body: AttachToHomeInput
  ): Promise<void> {
    return this.home.attach(user.userId, workspaceId, homeId, body);
  }

  @Post(":homeId/detach")
  @HttpCode(204)
  detach(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Body(new ZodValidationPipe(attachToHomeInputSchema)) body: AttachToHomeInput
  ): Promise<void> {
    return this.home.detach(user.userId, workspaceId, homeId, body);
  }

  @Post(":homeId/meters")
  createMeter(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Body(new ZodValidationPipe(createMeterInputSchema)) body: CreateMeterInput
  ): Promise<Meter> {
    return this.home.createMeter(user.userId, workspaceId, homeId, body);
  }

  @Patch(":homeId/meters/:meterId")
  updateMeter(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Param("meterId") meterId: string,
    @Body(new ZodValidationPipe(updateMeterInputSchema)) body: UpdateMeterInput
  ): Promise<Meter> {
    return this.home.updateMeter(user.userId, workspaceId, homeId, meterId, body);
  }

  @Delete(":homeId/meters/:meterId")
  @HttpCode(204)
  removeMeter(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Param("meterId") meterId: string
  ): Promise<void> {
    return this.home.removeMeter(user.userId, workspaceId, homeId, meterId);
  }

  @Post(":homeId/meters/:meterId/readings")
  addReading(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Param("meterId") meterId: string,
    @Body(new ZodValidationPipe(createMeterReadingInputSchema)) body: CreateMeterReadingInput
  ): Promise<Meter> {
    return this.home.addReading(user.userId, workspaceId, homeId, meterId, body);
  }

  @Delete(":homeId/meters/:meterId/readings/:readingId")
  removeReading(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Param("meterId") meterId: string,
    @Param("readingId") readingId: string
  ): Promise<Meter> {
    return this.home.removeReading(user.userId, workspaceId, homeId, meterId, readingId);
  }

  @Post(":homeId/contacts")
  createContact(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Body(new ZodValidationPipe(createContactInputSchema)) body: CreateContactInput
  ): Promise<Contact> {
    return this.home.createContact(user.userId, workspaceId, homeId, body);
  }

  @Patch(":homeId/contacts/:contactId")
  updateContact(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(updateContactInputSchema)) body: UpdateContactInput
  ): Promise<Contact> {
    return this.home.updateContact(user.userId, workspaceId, homeId, contactId, body);
  }

  @Delete(":homeId/contacts/:contactId")
  @HttpCode(204)
  removeContact(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("homeId") homeId: string,
    @Param("contactId") contactId: string
  ): Promise<void> {
    return this.home.removeContact(user.userId, workspaceId, homeId, contactId);
  }
}
