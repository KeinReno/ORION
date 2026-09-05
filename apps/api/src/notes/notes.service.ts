import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
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
    const notes = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.note.findMany({
        where: { workspaceId },
        orderBy: { updatedAt: "desc" }
      });
    });
    return notes.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateNoteInput): Promise<Note> {
    const note = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.note.create({
        data: { workspaceId, title: input.title, body: input.body }
      });
    });
    return toDto(note);
  }

  async update(userId: string, workspaceId: string, noteId: string, input: UpdateNoteInput): Promise<Note> {
    const note = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, noteId);
      return tx.note.update({ where: { id: noteId }, data: input });
    });
    return toDto(note);
  }

  async remove(userId: string, workspaceId: string, noteId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, noteId);
      await tx.note.delete({ where: { id: noteId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, noteId: string): Promise<void> {
    const note = await tx.note.findUnique({ where: { id: noteId } });
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
