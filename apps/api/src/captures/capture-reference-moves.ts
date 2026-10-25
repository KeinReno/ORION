import { Injectable, type OnModuleInit } from "@nestjs/common";
import { captureAnchorTypeSchema } from "@orion/shared-types";
import { EntityReferenceRegistry } from "../common/entity-reference-registry";

@Injectable()
export class CaptureReferenceMoves implements OnModuleInit {
  constructor(private readonly references: EntityReferenceRegistry) {}
  onModuleInit(): void {
    this.references.register("captures", async (tx, move) => {
      const anchor = captureAnchorTypeSchema.safeParse(move.entityType);
      if (!anchor.success) return;
      await tx.capture.updateMany({
        where: { workspaceId: move.workspaceId, anchorType: anchor.data, anchorId: { in: [...move.fromIds] } },
        data: { anchorId: move.toId }
      });
    });
  }
}
