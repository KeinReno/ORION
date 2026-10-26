import type { Prisma } from "@prisma/client";
import type { Note, NoteView, CreateNoteInput, UpdateNoteInput } from "@orion/shared-types";

/** Public note operations; preserves revisions, wiki links, privacy and trash behavior. */
export abstract class NoteOperations {
  abstract list(userId: string, workspaceId: string, search?: string, view?: NoteView, templates?: boolean): Promise<Note[]>;
  abstract getOne(userId: string, workspaceId: string, noteId: string): Promise<Note>;
  abstract create(userId: string, workspaceId: string, input: CreateNoteInput, agentName?: string): Promise<Note>;
  abstract createTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateNoteInput, agentName?: string): Promise<{ id: string }>;
  abstract update(userId: string, workspaceId: string, noteId: string, input: UpdateNoteInput, agentName?: string): Promise<Note>;
  abstract remove(userId: string, workspaceId: string, noteId: string): Promise<void>;
}
