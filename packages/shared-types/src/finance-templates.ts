import { z } from "zod";
import { transactionTypeSchema } from "./finance";

/**
 * Plugin `finance-templates`: a saved starting point for an operation that repeats without a schedule. A template is not
 * money — using it writes an ordinary transaction. `amount: null` means «спросить сумму каждый раз», not zero.
 */
export const financeTemplateSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  type: transactionTypeSchema,
  accountId: z.string().nullable(),
  toAccountId: z.string().nullable(),
  categoryId: z.string().nullable(),
  projectId: z.string().nullable(),
  amount: z.number().int().positive().nullable(),
  note: z.string(),
  tags: z.array(z.string()),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type FinanceTemplate = z.infer<typeof financeTemplateSchema>;

export const createFinanceTemplateInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(60),
  type: transactionTypeSchema.default("expense"),
  accountId: z.string().nullable().optional(),
  toAccountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  amount: z.number().int().positive().max(2_000_000_000).nullable().optional(),
  note: z.string().max(2000).default(""),
  tags: z.array(z.string().min(1).max(40)).max(20).default([])
});
export type CreateFinanceTemplateInput = z.infer<typeof createFinanceTemplateInputSchema>;

export const updateFinanceTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  type: transactionTypeSchema.optional(),
  accountId: z.string().nullable().optional(),
  toAccountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  amount: z.number().int().positive().max(2_000_000_000).nullable().optional(),
  note: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional()
});
export type UpdateFinanceTemplateInput = z.infer<typeof updateFinanceTemplateInputSchema>;
