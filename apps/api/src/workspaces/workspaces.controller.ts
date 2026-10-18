import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  createWorkspaceInputSchema,
  setWorkspaceThemeInputSchema,
  type SetWorkspaceThemeInput,
  updateWorkspaceInputSchema,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type Workspace,
  type WorkspaceMemberSearchResult
} from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { WorkspacesService } from "./workspaces.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get("me")
  listMine(@CurrentUser() user: RequestUser): Promise<Workspace[]> {
    return this.workspaces.listForUser(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createWorkspaceInputSchema)) body: CreateWorkspaceInput
  ): Promise<Workspace> {
    return this.workspaces.createForUser(user.userId, body.name, body.template);
  }

  @Patch(":workspaceId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(updateWorkspaceInputSchema)) body: UpdateWorkspaceInput
  ): Promise<Workspace> {
    return this.workspaces.updateName(user.userId, workspaceId, body.name);
  }

  @Put(":workspaceId/theme")
  setTheme(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(setWorkspaceThemeInputSchema)) body: SetWorkspaceThemeInput
  ): Promise<Workspace> {
    return this.workspaces.setTheme(user.userId, workspaceId, body.theme);
  }

  @Delete(":workspaceId")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<void> {
    await this.workspaces.deleteForUser(user.userId, workspaceId);
  }

  /** U09 — grant-issue recipient picker, see `WorkspacesService.searchMembers`. */
  @Get(":workspaceId/members-search")
  searchMembers(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("q") q: string | undefined
  ): Promise<WorkspaceMemberSearchResult[]> {
    return this.workspaces.searchMembers(user.userId, workspaceId, q ?? "");
  }
}
