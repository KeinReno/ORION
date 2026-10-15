import { z } from "zod";
import { createTransactionInputSchema } from "./finance";

/**
 * Plugin `finance-ai-drafts` + scope `finance:draft` of the AI bridge (ADR-0007): an agent that has READ a receipt
 * (OCR is the agent's job, not ORION's) may only PROPOSE an operation. The proposal is a draft — it moves no balance and
 * appears in no report. A human sees a preview, can correct every field, and only their confirmation writes the real
 * operation. A draft can never create a transfer, and never writes anything itself.
 */
export const agentFinanceDraftInputSchema = z.object({
  type: z.enum(["expense", "income"]).default("expense"),
  /** Minor units (kopecks), positive. */
  amount: z.number().int().positive("Сумма должна быть больше нуля").max(2_000_000_000),
  /** Informational: what the document says. The account decides the real currency. */
  currency: z.string().length(3).nullable().optional(),
  occurredAt: z.string().datetime(),
  /** Shop / payee as printed. */
  merchant: z.string().trim().max(120).default(""),
  note: z.string().max(2000).default(""),
  /** Optional hints — must belong to this workspace, otherwise the draft is refused (400), not silently altered. */
  accountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  /** 0..1, how sure the agent is. Shown to the human; never used to skip confirmation. */
  confidence: z.number().min(0).max(1).nullable().optional(),
  /** Where it came from, e.g. «чек из файла IMG_204.jpg». */
  sourceNote: z.string().trim().max(300).default("")
});
export type AgentFinanceDraftInput = z.infer<typeof agentFinanceDraftInputSchema>;

export const financeDraftStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type FinanceDraftStatus = z.infer<typeof financeDraftStatusSchema>;

export const financeDraftSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  tokenName: z.string(),
  status: financeDraftStatusSchema,
  type: z.enum(["expense", "income"]),
  amount: z.number().int().positive(),
  currency: z.string().nullable(),
  occurredAt: z.string(),
  merchant: z.string(),
  note: z.string(),
  accountId: z.string().nullable(),
  categoryId: z.string().nullable(),
  confidence: z.number().nullable(),
  sourceNote: z.string(),
  /** The operation the human wrote from this draft. */
  transactionId: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable()
});
export type FinanceDraft = z.infer<typeof financeDraftSchema>;

/** The human confirms with the full operation — every field editable, so the draft is a starting point only. */
export const acceptFinanceDraftInputSchema = createTransactionInputSchema;
export type AcceptFinanceDraftInput = z.infer<typeof acceptFinanceDraftInputSchema>;

/** What an agent may see to fill a draft sensibly: names and ids only — no balances, no operations. */
export const agentFinanceRefsSchema = z.object({
  accounts: z.array(z.object({ id: z.string(), name: z.string(), currency: z.string(), kind: z.string() })),
  categories: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["income", "expense"]) }))
});
export type AgentFinanceRefs = z.infer<typeof agentFinanceRefsSchema>;

/** Pending drafts per token: a flooding or looping agent hits this, not the user's screen. */
export const MAX_PENDING_DRAFTS_PER_TOKEN = 50;
