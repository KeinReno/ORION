import { z } from "zod";
import { workspaceRoleSchema } from "./workspace";

export const workspaceInviteStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);
export type WorkspaceInviteStatus = z.infer<typeof workspaceInviteStatusSchema>;

export const workspaceInviteSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  email: z.string(),
  role: workspaceRoleSchema,
  status: workspaceInviteStatusSchema,
  invitedById: z.string(),
  /** null = приглашение бессрочное (владелец выбрал «без срока» при создании/повторе). */
  expiresAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** Кто отозвал — аудит (12.2); null для ещё не отозванных. */
  revokedById: z.string().nullable(),
  /** Последняя повторная отправка: когда и кем; счётчик — сколько раз всего. */
  resentAt: z.string().nullable(),
  resentById: z.string().nullable(),
  resendCount: z.number().int().nonnegative(),
  createdAt: z.string()
});
export type WorkspaceInvite = z.infer<typeof workspaceInviteSchema>;

/**
 * Returned only once, right from the create response — there is no outbound
 * email integration yet, so the raw accept link is the delivery mechanism
 * (owner copies/shares it manually, same dry-run posture as Telegram before
 * a bot token is configured). Never re-derivable afterwards: the server only
 * ever stores `tokenHash`.
 */
export const createdWorkspaceInviteSchema = workspaceInviteSchema.extend({
  acceptUrl: z.string(),
  /** Тот же токен без адреса — код, который можно ввести на устройстве в LAN вместо перехода по ссылке. Показывается один раз. */
  code: z.string()
});
export type CreatedWorkspaceInvite = z.infer<typeof createdWorkspaceInviteSchema>;

/** Роль, с которой человек войдёт. `owner` приглашением не выдаётся; `lead` может назначить только владелец. */
export const inviteRoleSchema = z.enum(["member", "lead"]);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const createWorkspaceInviteInputSchema = z.object({
  email: z.string().trim().email("Введите корректный email"),
  role: inviteRoleSchema.default("member"),
  /**
   * Срок в днях. Не указан — 7 дней (явный дефолт, 12.2). `null` — бессрочно, осознанный выбор
   * владельца, как у agent-аренды; скрытых дефолтов нет. Максимум 3650 дней.
   */
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional()
});
export type CreateWorkspaceInviteInput = z.infer<typeof createWorkspaceInviteInputSchema>;

/** Повторная отправка: ссылка выдаётся заново (старый токен перестаёт работать), срок перезапускается. */
export const resendWorkspaceInviteInputSchema = z.object({
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional()
});
export type ResendWorkspaceInviteInput = z.infer<typeof resendWorkspaceInviteInputSchema>;

/**
 * Человеческое членство. `kind`/`status` добавлены заданием 12: агентские членства этот DTO тоже
 * описывает, но `GET /members` (старый контракт) по-прежнему отдаёт только живых людей, чтобы не
 * ломать клиентов; единый список людей, приглашённых и агентов — `GET /team` (`teamEntrySchema`).
 */
export const workspaceMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  /** Whether this member has an uploaded avatar image — see `AccountAvatar`. */
  hasAvatar: z.boolean(),
  role: workspaceRoleSchema,
  /** Principal discriminator, всегда "human" в этом DTO (см. комментарий выше). */
  kind: z.enum(["human", "agent"]),
  /** "active" | "disabled". */
  status: z.enum(["active", "disabled"]),
  agentProfileId: z.string().nullable(),
  createdAt: z.string()
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/** Owner-only — a lead cannot escalate anyone (including itself) to owner or lead. */
export const updateWorkspaceMemberRoleInputSchema = z.object({
  role: workspaceRoleSchema
});
export type UpdateWorkspaceMemberRoleInput = z.infer<typeof updateWorkspaceMemberRoleInputSchema>;

/**
 * What the accept screen shows before the user commits — no auth required to
 * look this up. `status` distinguishes *why* an invite can't be accepted
 * (S22): "expired" (TTL passed), "used" (already accepted, by this user or
 * someone else), "revoked" (owner pulled it) each get their own message —
 * collapsing them into one boolean lost that distinction.
 */
export const inviteLookupStatusSchema = z.enum(["pending", "expired", "used", "revoked"]);
export type InviteLookupStatus = z.infer<typeof inviteLookupStatusSchema>;

export const inviteLookupSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string(),
  email: z.string(),
  status: inviteLookupStatusSchema
});
export type InviteLookup = z.infer<typeof inviteLookupSchema>;
