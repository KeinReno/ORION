import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import {
  createPetCareEventInputSchema,
  importMurhpInputSchema,
  petCareRangeQuerySchema,
  petDayKeySchema,
  upsertPetCareDayInputSchema,
  type CreatePetCareEventInput,
  type ImportMurhpInput,
  type ImportMurhpResult,
  type PetCareDayLog,
  type PetCareEvent,
  type PetCareRangeQuery,
  type UpsertPetCareDayInput
} from "@orion/shared-types";
import type { RequestUser } from "../../auth/jwt.strategy";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequireModule } from "../../modules/require-module";
import { PetCareWellbeingService } from "./pet-care-wellbeing.service";

/** Дневник самочувствия питомца (перенос MurHP): дни, события, импорт копии. Маршрут тот же, что у `PetCareController`. */
@RequireModule("pet-care")
@Controller("workspaces/:workspaceId/pet-care/pets/:petId")
export class PetCareWellbeingController {
  constructor(private readonly wellbeing: PetCareWellbeingService) {}

  @Get("days")
  listDays(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Query(new ZodValidationPipe(petCareRangeQuerySchema)) query: PetCareRangeQuery
  ): Promise<PetCareDayLog[]> {
    return this.wellbeing.listDays(user.userId, workspaceId, petId, query);
  }

  /** Заменяет запись дня целиком; повтор того же запроса даёт тот же результат. */
  @Put("days/:day")
  upsertDay(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Param("day", new ZodValidationPipe(petDayKeySchema)) day: string,
    @Body(new ZodValidationPipe(upsertPetCareDayInputSchema)) body: UpsertPetCareDayInput
  ): Promise<PetCareDayLog> {
    return this.wellbeing.upsertDay(user.userId, workspaceId, petId, day, body);
  }

  @Delete("days/:day")
  @HttpCode(204)
  async deleteDay(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Param("day", new ZodValidationPipe(petDayKeySchema)) day: string
  ): Promise<void> {
    await this.wellbeing.deleteDay(user.userId, workspaceId, petId, day);
  }

  @Get("events")
  listEvents(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Query(new ZodValidationPipe(petCareRangeQuerySchema)) query: PetCareRangeQuery
  ): Promise<PetCareEvent[]> {
    return this.wellbeing.listEvents(user.userId, workspaceId, petId, query);
  }

  @Post("events")
  createEvent(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Body(new ZodValidationPipe(createPetCareEventInputSchema)) body: CreatePetCareEventInput
  ): Promise<PetCareEvent> {
    return this.wellbeing.createEvent(user.userId, workspaceId, petId, body);
  }

  @Delete("events/:eventId")
  @HttpCode(204)
  async deleteEvent(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Param("eventId") eventId: string
  ): Promise<void> {
    await this.wellbeing.deleteEvent(user.userId, workspaceId, petId, eventId);
  }

  /** Резервная копия MurHP (`.json`) → дни, события и пустые поля профиля питомца. Повторный импорт ничего не дублирует. */
  @Post("import-murhp")
  importMurhp(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Body(new ZodValidationPipe(importMurhpInputSchema)) body: ImportMurhpInput
  ): Promise<ImportMurhpResult> {
    return this.wellbeing.importMurhp(user.userId, workspaceId, petId, body);
  }
}
