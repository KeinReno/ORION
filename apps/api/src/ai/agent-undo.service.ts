import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AgentAuditEntry } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { NoteOperations } from "../notes/public/note-operations";
import { TaskOperations } from "../tasks/public/task-operations";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { auditDto } from "./agent-tokens.service";

/**
 * "Отменить создание" from the journal (TZ-03 §3.4): a note an agent created goes to the trash (restorable for 30
 * days), a task becomes `canceled` — neither is hard-deleted, and the human does it under their own rights.
 * Tasks have no trash in ORION; `canceled` is the soft "undone" state the rest of the app already understands.
 */
@Injectable()
export class AgentUndoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly notes: NoteOperations,
    private readonly tasks: TaskOperations
  ) {}

  async undoCreation(userId: string, workspaceId: string, entryId: string): Promise<AgentAuditEntry> {
    // Claim first (one atomic statement), so a double click cannot run the undo twice.
    const entry = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const found = await tx.agentAuditEntry.findFirst({ where: { id: entryId, workspaceId } });
      if (!found) throw new NotFoundException("Запись журнала не найдена");
      if (!found.action.endsWith(".create") || !found.objectId || (found.objectType !== "note" && found.objectType !== "task") || found.status >= 300) {
        throw new ConflictException("Эту запись нельзя отменить");
      }
      const claimed = await tx.agentAuditEntry.updateMany({ where: { id: entryId, undoneAt: null }, data: { undoneAt: new Date() } });
      if (claimed.count === 0) throw new ConflictException("Создание уже отменено");
      return found;
    });
    try {
      if (entry.objectType === "note") await this.notes.remove(userId, workspaceId, entry.objectId as string);
      else await this.tasks.update(userId, workspaceId, entry.objectId as string, { status: "canceled" });
    } catch (error) {
      // Already gone is a fine outcome of "undo"; anything else releases the claim so the human can retry.
      if (!(error instanceof NotFoundException)) {
        await this.prisma.withUser(userId, (tx) => tx.agentAuditEntry.updateMany({ where: { id: entryId }, data: { undoneAt: null } }));
        throw error;
      }
    }
    const row = await this.prisma.withUser(userId, (tx) => tx.agentAuditEntry.findUniqueOrThrow({ where: { id: entryId } }));
    return auditDto(row);
  }
}
