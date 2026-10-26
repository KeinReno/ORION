import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Existence only; archived references retain the existing capture policy. */
export abstract class HomeReferences {
  abstract existsTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<boolean>;
  /** Preserves the 400 reference policy used by task/list/stock/contact/bill creation. */
  async assertTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<void> {
    if (!await this.existsTx(tx, workspaceId, homeId)) throw new BadRequestException("Дом не найден в этом рабочем пространстве");
  }
}
