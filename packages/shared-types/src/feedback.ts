/**
 * Обратная связь из приложения (баг/предложение) — улетает в issue GitHub (см. `FeedbackService`
 * на сервере). Нет своей модели БД: ничего не хранится в ORION, только проксируется наружу.
 */

import { z } from "zod";

export const FEEDBACK_KINDS = ["bug", "idea"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const sendFeedbackInputSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(1).max(4000)
});
export type SendFeedbackInput = z.infer<typeof sendFeedbackInputSchema>;

export const feedbackResultSchema = z.object({
  issueUrl: z.string()
});
export type FeedbackResult = z.infer<typeof feedbackResultSchema>;
