import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  createPetCareEntryInputSchema,
  createPetCarePetInputSchema,
  updatePetCarePetInputSchema,
  type CreatePetCareEntryInput,
  type CreatePetCarePetInput,
  type PetCareEntry,
  type PetCarePet,
  type UpdatePetCarePetInput
} from "@orion/shared-types";
import type { RequestUser } from "../../auth/jwt.strategy";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequireModule } from "../../modules/require-module";
import { PetCareService } from "./pet-care.service";

@RequireModule("pet-care")
@Controller("workspaces/:workspaceId/pet-care")
export class PetCareController {
  constructor(private readonly petCare: PetCareService) {}

  @Get("pets")
  listPets(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<PetCarePet[]> {
    return this.petCare.listPets(user.userId, workspaceId);
  }

  @Post("pets")
  createPet(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createPetCarePetInputSchema)) body: CreatePetCarePetInput
  ): Promise<PetCarePet> {
    return this.petCare.createPet(user.userId, workspaceId, body);
  }

  @Patch("pets/:petId")
  updatePet(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Body(new ZodValidationPipe(updatePetCarePetInputSchema)) body: UpdatePetCarePetInput
  ): Promise<PetCarePet> {
    return this.petCare.updatePet(user.userId, workspaceId, petId, body);
  }

  /** Удаляет питомца вместе с записями ухода (каскад) — в отличие от выключения модуля, это осознанное действие. */
  @Delete("pets/:petId")
  @HttpCode(204)
  async deletePet(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string
  ): Promise<void> {
    await this.petCare.deletePet(user.userId, workspaceId, petId);
  }

  @Get("pets/:petId/entries")
  listEntries(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string
  ): Promise<PetCareEntry[]> {
    return this.petCare.listEntries(user.userId, workspaceId, petId);
  }

  @Post("pets/:petId/entries")
  createEntry(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Body(new ZodValidationPipe(createPetCareEntryInputSchema)) body: CreatePetCareEntryInput
  ): Promise<PetCareEntry> {
    return this.petCare.createEntry(user.userId, workspaceId, petId, body);
  }

  @Delete("pets/:petId/entries/:entryId")
  @HttpCode(204)
  async deleteEntry(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("petId") petId: string,
    @Param("entryId") entryId: string
  ): Promise<void> {
    await this.petCare.deleteEntry(user.userId, workspaceId, petId, entryId);
  }
}
