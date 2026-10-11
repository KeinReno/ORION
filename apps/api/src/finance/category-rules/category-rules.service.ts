import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CategoryRule, CreateCategoryRuleInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { assertCategoryInWorkspace } from "../finance-refs.util";

/**
 * Plain CRUD, mirroring `categories/` — no `update`: a rule is one
 * matchText→category pair, cheap enough to delete and recreate rather than
 * PATCH. Matching itself happens only in the frontend (`TransactionForm`),
 * see docs/HISTORY.md v0.13.
 */
@Injectable()
export class CategoryRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<CategoryRule[]> {
    const rules = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.categoryRule.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
    });
    return rules.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateCategoryRuleInput): Promise<CategoryRule> {
    const rule = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertCategoryInWorkspace(tx, workspaceId, input.categoryId);
      return tx.categoryRule.create({
        data: { workspaceId, matchText: input.matchText, categoryId: input.categoryId }
      });
    });
    return toDto(rule);
  }

  async remove(userId: string, workspaceId: string, ruleId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, ruleId);
      await tx.categoryRule.delete({ where: { id: ruleId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, ruleId: string): Promise<void> {
    const rule = await tx.categoryRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.workspaceId !== workspaceId) {
      throw new NotFoundException("Правило не найдено");
    }
  }
}

type CategoryRuleRow = {
  id: string;
  workspaceId: string;
  matchText: string;
  categoryId: string;
  createdAt: Date;
};

function toDto(rule: CategoryRuleRow): CategoryRule {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    matchText: rule.matchText,
    categoryId: rule.categoryId,
    createdAt: rule.createdAt.toISOString()
  };
}
