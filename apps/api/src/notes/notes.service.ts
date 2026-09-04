import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateNoteInput, Note, UpdateNoteInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<Note[]> {
    await this.workspaces.assertMember(userId, workspaceId);
    const notes = await this.prisma.note.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" }
    });
    return notes.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateNoteInput): Promise<Note> {
    await this.workspaces.assertMember(userId, workspaceId);
    const note = await this.prisma.note.create({
      data: { workspaceId, title: input.title, body: input.body }
    });
    return toDto(note);
  }

  async update(userId: string, workspaceId: string, noteId: string, input: UpdateNoteInput): Promise<Note> {
    await this.workspaces.assertMember(userId, workspaceId);
    await this.getOwned(workspaceId, noteId);
    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: input
    });
    return toDto(note);
  }

  async remove(userId: string, workspaceId: string, noteId: string): Promise<void> {
    await this.workspaces.assertMember(userId, workspaceId);
    await this.getOwned(workspaceId, noteId);
    await this.prisma.note.delete({ where: { id: noteId } });
  }

  private async getOwned(workspaceId: string, noteId: string): Promise<void> {
    const note = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!note || note.workspaceId !== workspaceId) {
      throw new NotFoundException("Заметка не найдена");
    }
  }
}

function toDto(note: { id: string; workspaceId: string; title: string; body: string; createdAt: Date; updatedAt: Date }): Note {
  return {
    id: note.id,
    workspaceId: note.workspaceId,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString()
  };
}
