import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ProjectReferences } from "./public/project-references";

/** Projects owns this query; .service.ts keeps model access under architecture-check. */
@Injectable()
export class ProjectReferenceReader extends ProjectReferences {
  async existsTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<boolean> {
    const project = await tx.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
    return project !== null;
  }
}
