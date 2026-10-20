import { z } from "zod";
import { habitDayKeySchema } from "./habit";

/** Inputs of the core modules' agent tools (`orion_habits_*`, `orion_lists_*`, …, see `agent-tools.ts`). */

export const agentHabitsListQuerySchema = z.object({ today: habitDayKeySchema.optional() });
export type AgentHabitsListQuery = z.infer<typeof agentHabitsListQuerySchema>;

export const agentHabitMarkDoneInputSchema = z.object({ day: habitDayKeySchema.optional() });
export type AgentHabitMarkDoneInput = z.infer<typeof agentHabitMarkDoneInputSchema>;

export const agentListAddItemsInputSchema = z.object({ text: z.string().trim().min(1, "Нечего добавлять").max(5000) });
export type AgentListAddItemsInput = z.infer<typeof agentListAddItemsInputSchema>;

export const agentPeriodQuerySchema = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() });
export type AgentPeriodQuery = z.infer<typeof agentPeriodQuerySchema>;

export const agentSearchQuerySchema = z.object({ query: z.string().trim().max(200).optional() });
export type AgentSearchQuery = z.infer<typeof agentSearchQuerySchema>;

export const agentFinanceTransactionsQuerySchema = agentPeriodQuerySchema.extend({
  accountId: z.string().min(1).max(80).optional(),
  q: z.string().trim().max(200).optional()
});
export type AgentFinanceTransactionsQuery = z.infer<typeof agentFinanceTransactionsQuerySchema>;

/** A document's extracted text for the agent; long text is cut at `AGENT_DOCUMENT_TEXT_MAX` characters. */
export const AGENT_DOCUMENT_TEXT_MAX = 20_000;
export const agentDocumentTextSchema = z.object({ id: z.string(), name: z.string(), text: z.string(), truncated: z.boolean() });
export type AgentDocumentText = z.infer<typeof agentDocumentTextSchema>;

/** «Сколько отработано»: the period's summary plus the running timer, if any. */
export function defaultAgentPeriod(now: Date = new Date()): { from: string; to: string } {
  return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
}
