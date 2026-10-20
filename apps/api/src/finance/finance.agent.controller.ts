import { Body, Controller, Delete, Get, OnModuleInit, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  agentDeleteRequestSchema,
  agentFinanceTransactionsQuerySchema,
  defaultAgentPeriod,
  type Account,
  type AgentDeleteRequest,
  type AgentFinanceTransactionsQuery,
  type Transaction
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AccountsService } from "./accounts/accounts.service";
import { TransactionsService } from "./transactions/transactions.service";

/**
 * Инструменты ИИ-агента для модуля «Финансы» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/finance")
export class FinanceAgentController implements OnModuleInit {
  constructor(
    private readonly accounts: AccountsService,
    private readonly transactions: TransactionsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    this.tools.register("orion_finance_delete_transaction", {
      noun: "операция",
      describe: async (userId, workspaceId, transactionId) => {
        const tx = await this.transactions.get(userId, workspaceId, transactionId).catch(() => null);
        return tx
          ? {
              title: `${(tx.totalAmount / 100).toFixed(2)} от ${tx.occurredAt.slice(0, 10)}${tx.note ? ` — ${tx.note}` : ""}`,
              fields: { type: tx.type, totalAmount: tx.totalAmount, occurredAt: tx.occurredAt, note: tx.note },
              labels: { type: "Вид", totalAmount: "Сумма, коп.", occurredAt: "Дата", note: "Заметка" }
            }
          : null;
      },
      apply: (userId, workspaceId, transactionId) => this.transactions.remove(userId, workspaceId, transactionId)
    });
  }

  /** Only what the token's human sees (private accounts stay private: the services read with their rights). */
  @Get("accounts")
  listAccounts(@Req() req: AgentRequest): Promise<Account[]> {
    return this.tools.run(req, "orion_finance_accounts", (agent) => this.accounts.list(agent.userId, agent.workspaceId));
  }

  @Get("transactions")
  listTransactions(@Req() req: AgentRequest, @Query(new ZodValidationPipe(agentFinanceTransactionsQuerySchema)) query: AgentFinanceTransactionsQuery): Promise<Transaction[]> {
    return this.tools.run(req, "orion_finance_transactions", (agent) =>
      this.transactions.list(agent.userId, agent.workspaceId, { ...defaultAgentPeriod(), ...query, limit: 100 })
    );
  }

  /** Money is never deleted by an agent directly, in any mode: always a request the human confirms. */
  @Delete("transactions/:transactionId")
  deleteTransaction(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("transactionId") transactionId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_finance_delete_transaction", transactionId, {}, { reason: body.reason });
  }
}
