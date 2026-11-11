import { z } from "zod";
import { workspaceRoleSchema } from "./workspace";

/**
 * Задание 12 — «Команда и разграничение прав человек/ИИ».
 *
 * Люди и агенты видны в одной команде, но это РАЗНЫЕ principal-модели: членство человека ссылается
 * на `User` и даёт права роли, членство агента ссылается на профиль Agent Hub и не даёт ничего
 * сверх scopes токена (ADR-0007) и явных grants. Дискриминатор — `kind` на уровне членства.
 */
export const principalKindSchema = z.enum(["human", "agent"]);
export type PrincipalKind = z.infer<typeof principalKindSchema>;

/**
 * `active` — участник работает; `disabled` — агентское членство в ростере, но подключение
 * выключено (отзыв credential по ADR-0047; сама строка членства при этом не удаляется);
 * `invited` — это НЕ членство, а непринятое приглашение, показанное в общем списке команды.
 */
export const teamEntryStatusSchema = z.enum(["active", "disabled", "invited"]);
export type TeamEntryStatus = z.infer<typeof teamEntryStatusSchema>;

/**
 * Одна строка `GET /workspaces/:id/team` — люди, приглашённые и агенты в одном списке.
 * `id` — id членства (`memberId`) или приглашения (`inviteId`); ровно одно из них заполнено.
 */
export const teamEntrySchema = z.object({
  id: z.string(),
  kind: principalKindSchema,
  status: teamEntryStatusSchema,
  role: workspaceRoleSchema,
  memberId: z.string().nullable(),
  inviteId: z.string().nullable(),
  /** User.id — только у человеческого членства; null у агента и у приглашения. */
  userId: z.string().nullable(),
  /** AgentHubAgentProfile.id — только у агентского членства. */
  agentProfileId: z.string().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  hasAvatar: z.boolean(),
  createdAt: z.string(),
  /** Срок приглашения; null = бессрочно (и null у членства — у него срока нет). */
  expiresAt: z.string().nullable(),
  invitedById: z.string().nullable(),
  revokedById: z.string().nullable(),
  resendCount: z.number().int().nonnegative()
});
export type TeamEntry = z.infer<typeof teamEntrySchema>;

/** Фильтры единого списка команды. `status` не фильтрует приглашения по роли — только по статусу. */
export const teamQuerySchema = z.object({
  kind: principalKindSchema.optional(),
  status: teamEntryStatusSchema.optional()
});
export type TeamQuery = z.infer<typeof teamQuerySchema>;

/**
 * Событие в очереди агентского членства (12.3). Сейчас единственный вид — упоминание в
 * комментарии задачи; поле `kind` оставлено строкой, чтобы будущие виды не требовали миграции.
 */
export const agentMemberEventSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  memberId: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string()
});
export type AgentMemberEvent = z.infer<typeof agentMemberEventSchema>;
