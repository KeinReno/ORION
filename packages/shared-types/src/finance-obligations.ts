import { z } from "zod";

/**
 * Обязательства: долг, кредит, коммунальный платёж, подписка. Это ПЛАН, а не деньги: сам по себе он не меняет ни один
 * баланс. Деньги двигает только «Оплатить» — оно записывает обычную операцию в выбранный счёт (повторно тот же
 * платёж не записывается). `direction`: owe — платит пространство, owed — платят пространству.
 */
export const OBLIGATION_KINDS = ["debt", "credit", "utility", "subscription", "other"] as const;
export const obligationKindSchema = z.enum(OBLIGATION_KINDS);
export type ObligationKind = z.infer<typeof obligationKindSchema>;

export const OBLIGATION_KIND_LABEL: Record<ObligationKind, string> = {
  debt: "Долг",
  credit: "Кредит",
  utility: "Коммунальные",
  subscription: "Подписка",
  other: "Другое"
};

export const obligationIntervalSchema = z.enum(["once", "monthly", "yearly"]);
export type ObligationInterval = z.infer<typeof obligationIntervalSchema>;

export const obligationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: obligationKindSchema,
  direction: z.enum(["owe", "owed"]),
  /** Остаток в минорных единицах; null — общая сумма не ведётся (коммунальные, подписка). */
  principal: z.number().int().nullable(),
  /** Плановый платёж за период. */
  payment: z.number().int(),
  interval: obligationIntervalSchema,
  nextDueAt: z.string().nullable(),
  accountId: z.string().nullable(),
  categoryId: z.string().nullable(),
  note: z.string(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Obligation = z.infer<typeof obligationSchema>;

export const createObligationInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(120),
  kind: obligationKindSchema.default("debt"),
  direction: z.enum(["owe", "owed"]).default("owe"),
  principal: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  payment: z.number().int().positive("Платёж должен быть больше нуля").max(2_000_000_000),
  interval: obligationIntervalSchema.default("monthly"),
  nextDueAt: z.string().datetime().nullable().optional(),
  accountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  note: z.string().max(2000).default("")
});
export type CreateObligationInput = z.infer<typeof createObligationInputSchema>;

export const updateObligationInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: obligationKindSchema.optional(),
  direction: z.enum(["owe", "owed"]).optional(),
  principal: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  payment: z.number().int().positive().max(2_000_000_000).optional(),
  interval: obligationIntervalSchema.optional(),
  nextDueAt: z.string().datetime().nullable().optional(),
  accountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  note: z.string().max(2000).optional(),
  /** null — открыть заново. */
  closedAt: z.string().datetime().nullable().optional()
});
export type UpdateObligationInput = z.infer<typeof updateObligationInputSchema>;

/** «Оплатить»: счёт обязателен (его подтверждает плательщик); сумма по умолчанию — плановый платёж. */
export const payObligationInputSchema = z.object({
  accountId: z.string(),
  amount: z.number().int().positive().max(2_000_000_000).optional(),
  paidAt: z.string().datetime().optional()
});
export type PayObligationInput = z.infer<typeof payObligationInputSchema>;

/** Следующий срок после платежа: месяц/год вперёд с тем же числом (31 → последний день короткого месяца). */
export function advanceObligationDue(due: Date, interval: ObligationInterval): Date | null {
  if (interval === "once") return null;
  const months = interval === "monthly" ? 1 : 12;
  const year = due.getUTCFullYear();
  const month = due.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(due.getUTCDate(), lastDay), due.getUTCHours(), due.getUTCMinutes(), due.getUTCSeconds()));
}
