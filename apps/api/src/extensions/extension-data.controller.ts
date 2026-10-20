import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from "@nestjs/common";
import {
  extensionCollectionSchema,
  extensionFetchInputSchema,
  extensionRecordKeySchema,
  putExtensionRecordInputSchema,
  setExtensionSecretInputSchema,
  type ExtensionFetchInput,
  type ExtensionFetchResult,
  type ExtensionRecord,
  type ExtensionSecretStatus,
  type PutExtensionRecordInput,
  type SetExtensionSecretInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { LoopbackOnlyGuard } from "../lan/lan.controller";
import { JsonBodyGuard } from "../updates/updates.controller";
import { ExtensionDataService } from "./extension-data.service";

const collectionPipe = new ZodValidationPipe(extensionCollectionSchema);
const keyPipe = new ZodValidationPipe(extensionRecordKeySchema);

/**
 * Данные, секреты и сеть расширений (ADR-0022, E3). Расширения — функция этого компьютера, поэтому и их API —
 * только с него (`LoopbackOnlyGuard`), с входом пользователя; изменения — только JSON.
 */
@UseGuards(LoopbackOnlyGuard, JwtAuthGuard)
@Controller()
export class ExtensionDataController {
  constructor(private readonly data: ExtensionDataService) {}

  @Get("workspaces/:workspaceId/ext/:extensionId/collections/:collection")
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("extensionId") extensionId: string,
    @Param("collection", collectionPipe) collection: string
  ): Promise<ExtensionRecord[]> {
    return this.data.list(user.userId, workspaceId, extensionId, collection);
  }

  @UseGuards(JsonBodyGuard)
  @Put("workspaces/:workspaceId/ext/:extensionId/collections/:collection/:key")
  put(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("extensionId") extensionId: string,
    @Param("collection", collectionPipe) collection: string,
    @Param("key", keyPipe) key: string,
    @Body(new ZodValidationPipe(putExtensionRecordInputSchema)) body: PutExtensionRecordInput
  ): Promise<ExtensionRecord> {
    return this.data.put(user.userId, workspaceId, extensionId, collection, key, body.data);
  }

  @Delete("workspaces/:workspaceId/ext/:extensionId/collections/:collection/:key")
  @HttpCode(204)
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("extensionId") extensionId: string,
    @Param("collection", collectionPipe) collection: string,
    @Param("key", keyPipe) key: string
  ): Promise<void> {
    return this.data.remove(user.userId, workspaceId, extensionId, collection, key);
  }

  @UseGuards(JsonBodyGuard)
  @Post("workspaces/:workspaceId/ext/:extensionId/fetch")
  @HttpCode(200)
  fetch(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("extensionId") extensionId: string,
    @Body(new ZodValidationPipe(extensionFetchInputSchema)) body: ExtensionFetchInput
  ): Promise<ExtensionFetchResult> {
    return this.data.fetch(user.userId, workspaceId, extensionId, body);
  }

  @Get("extensions/:extensionId/secrets")
  secrets(@CurrentUser() user: RequestUser, @Param("extensionId") extensionId: string): Promise<ExtensionSecretStatus[]> {
    return this.data.secrets(user.userId, extensionId);
  }

  @UseGuards(JsonBodyGuard)
  @Put("extensions/:extensionId/secrets/:name")
  setSecret(
    @CurrentUser() user: RequestUser,
    @Param("extensionId") extensionId: string,
    @Param("name") name: string,
    @Body(new ZodValidationPipe(setExtensionSecretInputSchema)) body: SetExtensionSecretInput
  ): Promise<ExtensionSecretStatus> {
    return this.data.setSecret(user.userId, extensionId, name, body.value);
  }

  @Delete("extensions/:extensionId/secrets/:name")
  @HttpCode(204)
  clearSecret(@CurrentUser() user: RequestUser, @Param("extensionId") extensionId: string, @Param("name") name: string): Promise<void> {
    return this.data.clearSecret(user.userId, extensionId, name);
  }
}
