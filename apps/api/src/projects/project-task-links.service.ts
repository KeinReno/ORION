import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ProjectTaskLinks } from "./public/project-task-links";

@Injectable()
export class ProjectTaskLinkQueries extends ProjectTaskLinks {
  byIdTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<{ id: string; name: string } | null> {
    return tx.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true, name: true } });
  }
  async findOrCreateByNameTx(tx: Prisma.TransactionClient, workspaceId: string, name: string): Promise<{ id: string; name: string }> {
    const found = await tx.project.findFirst({ where: { workspaceId, name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true } });
    return found ?? tx.project.create({ data: { workspaceId, name }, select: { id: true, name: true } });
  }
}
