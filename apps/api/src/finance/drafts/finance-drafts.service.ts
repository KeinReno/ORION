import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  MAX_PENDING_DRAFTS_PER_TOKEN,
  type AcceptFinanceDraftInput,
  type AgentFinanceDraftInput,
  type AgentFinanceRefs,
  type FinanceDraft,
  type Transaction
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { assertAccountInWorkspace, assertCategoryInWorkspace } from "../finance-refs.util";
import { TransactionsService } from "../transactions/transactions.service";

import type { DraftAuthor } from "../public/agent-draft-operations";
export type { DraftAuthor } from "../public/agent-draft-operations";

/**
 * Operations PROPOSED by an agent that read a receipt. A draft is never money: it moves no balance and shows in no
 * report. The agent can only create drafts; the human accepts one by sending the FULL operation (every field editable),
 * and that — the ordinary `TransactionsService.create` under the human's rights — is what writes it, once.
 */
@Injectable()
export class FinanceDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly transactions: TransactionsService
  ) {}

  /** Names and ids an agent needs to fill a draft sensibly. No balances, no operations. */
  async refs(userId: string, workspaceId: string): Promise<AgentFinanceRefs> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const [accounts, categories] = await Promise.all([
        tx.account.findMany({ where: { workspaceId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, currency: true, kind: true } }),
        tx.financeCategory.findMany({ where: { workspaceId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, kind: true } })
      ]);
      return { accounts, categories: categories.map((category) => ({ id: category.id, name: category.name, kind: category.kind as "income" | "expense" })) };
    });
  }

  /**
   * Idempotent: the same token sending the same pending draft twice (a retry) gets the existing one. A token with
   * `MAX_PENDING_DRAFTS_PER_TOKEN` undecided drafts is refused (429) until a human works through them.
   */
  async createFromAgent(author: DraftAuthor, input: AgentFinanceDraftInput): Promise<FinanceDraft> {
    const row = await this.prisma.withUser(author.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, author.userId, author.workspaceId);
      if (input.accountId) await assertAccountInWorkspace(tx, author.workspaceId, input.accountId);
      if (input.categoryId) await assertCategoryInWorkspace(tx, author.workspaceId, input.categoryId);

      const occurredAt = new Date(input.occurredAt);
      const existing = await tx.financeDraft.findFirst({
        where: { workspaceId: author.workspaceId, tokenId: author.tokenId, status: "pending", type: input.type, amount: input.amount, occurredAt, merchant: input.merchant }
      });
      if (existing) return existing;

      const pending = await tx.financeDraft.count({ where: { workspaceId: author.workspaceId, tokenId: author.tokenId, status: "pending" } });
      if (pending >= MAX_PENDING_DRAFTS_PER_TOKEN) {
        throw new HttpException(`Не больше ${MAX_PENDING_DRAFTS_PER_TOKEN} неразобранных черновиков на токен — сначала разберите их`, HttpStatus.TOO_MANY_REQUESTS);
      }
      return tx.financeDraft.create({
        data: {
          workspaceId: author.workspaceId,
          tokenId: author.tokenId,
          tokenName: author.tokenName,
          type: input.type,
          amount: input.amount,
          currency: input.currency ?? null,
          occurredAt,
          merchant: input.merchant,
          note: input.note,
          accountId: input.accountId ?? null,
          categoryId: input.categoryId ?? null,
          confidence: input.confidence ?? null,
          sourceNote: input.sourceNote
        }
      });
    });
    return toDto(row);
  }

  /** Undecided drafts first, then the latest decisions. */
  async list(userId: string, workspaceId: string): Promise<FinanceDraft[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.financeDraft.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 60 });
    });
    const dto = rows.map(toDto);
    return [...dto.filter((draft) => draft.status === "pending"), ...dto.filter((draft) => draft.status !== "pending")];
  }

  /**
   * The human confirms, with the operation they actually want. The draft is claimed first (pending → approved,
   * atomically), so two windows cannot both write it; if writing the operation fails the claim is put back.
   */
  async accept(userId: string, workspaceId: string, draftId: string, input: AcceptFinanceDraftInput): Promise<{ draft: FinanceDraft; transaction: Transaction }> {
    await this.claim(userId, workspaceId, draftId, "approved");
    let transaction: Transaction;
    try {
      transaction = await this.transactions.create(userId, workspaceId, input);
    } catch (error) {
      await this.prisma.withUser(userId, (tx) =>
        tx.financeDraft.updateMany({ where: { id: draftId, status: "approved", transactionId: null }, data: { status: "pending", decidedAt: null } })
      );
      throw error;
    }
    const row = await this.prisma.withUser(userId, (tx) =>
      tx.financeDraft.update({ where: { id: draftId }, data: { transactionId: transaction.id } })
    );
    return { draft: toDto(row), transaction };
  }

  async reject(userId: string, workspaceId: string, draftId: string): Promise<FinanceDraft> {
    return toDto(await this.claim(userId, workspaceId, draftId, "rejected"));
  }

  private async claim(userId: string, workspaceId: string, draftId: string, status: "approved" | "rejected") {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const result = await tx.financeDraft.updateMany({ where: { id: draftId, workspaceId, status: "pending" }, data: { status, decidedAt: new Date() } });
      if (result.count === 0) {
        const exists = await tx.financeDraft.findFirst({ where: { id: draftId, workspaceId } });
        throw exists ? new ConflictException("Черновик уже разобран") : new NotFoundException("Черновик не найден");
      }
      return tx.financeDraft.findUniqueOrThrow({ where: { id: draftId } });
    });
  }
}

type DraftRow = Prisma.FinanceDraftGetPayload<Record<string, never>>;

function toDto(row: DraftRow): FinanceDraft {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    tokenName: row.tokenName,
    status: row.status === "approved" || row.status === "rejected" ? row.status : "pending",
    type: row.type === "income" ? "income" : "expense",
    amount: row.amount,
    currency: row.currency,
    occurredAt: row.occurredAt.toISOString(),
    merchant: row.merchant,
    note: row.note,
    accountId: row.accountId,
    categoryId: row.categoryId,
    confidence: row.confidence,
    sourceNote: row.sourceNote,
    transactionId: row.transactionId,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null
  };
}
