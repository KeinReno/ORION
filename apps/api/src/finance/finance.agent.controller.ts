import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { agentFinanceTransactionsQuerySchema, defaultAgentPeriod, type Account, type AgentFinanceTransactionsQuery, type Transaction } from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
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
export class FinanceAgentController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly transactions: TransactionsService,
    private readonly tools: AgentModuleToolsService
  ) {}

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
}
