import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createNoteInputSchema, updateNoteInputSchema, type CreateNoteInput, type Note, type UpdateNoteInput } from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { NotesService } from "./notes.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/notes")
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<Note[]> {
    return this.notes.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createNoteInputSchema)) body: CreateNoteInput
  ): Promise<Note> {
    return this.notes.create(user.userId, workspaceId, body);
  }

  @Patch(":noteId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string,
    @Body(new ZodValidationPipe(updateNoteInputSchema)) body: UpdateNoteInput
  ): Promise<Note> {
    return this.notes.update(user.userId, workspaceId, noteId, body);
  }

  @Delete(":noteId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("noteId") noteId: string
  ): Promise<void> {
    return this.notes.remove(user.userId, workspaceId, noteId);
  }
}
