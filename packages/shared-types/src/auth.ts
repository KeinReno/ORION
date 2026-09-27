import { z } from "zod";

export const unlockKindSchema = z.enum(["password", "pin"]);
export type UnlockKind = z.infer<typeof unlockKindSchema>;

export const pinSchema = z.string().regex(/^\d{4}$/, "PIN — ровно 4 цифры");

export const registerInputSchema = z
  .object({
    name: z.string().trim().min(1, "Имя обязательно").max(120),
    email: z.string().trim().max(254).optional(),
    password: z.string().min(8, "Пароль должен быть не короче 8 символов").max(128).optional(),
    pin: pinSchema.optional()
  })
  .superRefine((value, ctx) => {
    const email = value.email?.trim();
    if (email && !z.string().email().safeParse(email).success) {
      ctx.addIssue({ code: "custom", message: "Введите корректный email", path: ["email"] });
    }
    if ((value.password ? 1 : 0) + (value.pin ? 1 : 0) !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Укажите пароль (от 8 символов) или PIN из 4 цифр",
        path: ["password"]
      });
    }
  });
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z
  .object({
    userId: z.string().min(1).optional(),
    /// Legacy: email or the short local identifier stored in `users.email`.
    email: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1).optional(),
    pin: pinSchema.optional()
  })
  .refine((value) => Boolean(value.userId || value.email), {
    message: "Выберите учётную запись"
  })
  .refine((value) => Boolean(value.password || value.pin), {
    message: "Введите пароль или PIN"
  });
export type LoginInput = z.infer<typeof loginInputSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string(),
  unlockKind: unlockKindSchema,
  hasAvatar: z.boolean(),
  /// 0–4 heuristic score of the stored password (see `passwordScore` in
  /// auth.service) — `User.passwordStrength` is NOT NULL with a default, so
  /// this is always present. Deliberately no `.default()` here: this is a
  /// *response* schema, and a default would silently invent a value when the
  /// server omits the field. It would also make the schema's input type
  /// diverge from its output type, which `ApiClient.request<T>` rejects.
  passwordStrength: z.number().int().min(0).max(4),
  /// When the password was last set; null for accounts created before v0.14.
  passwordChangedAt: z.string().nullable()
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const accountWorkspaceRefSchema = z.object({
  id: z.string(),
  name: z.string()
});
export type AccountWorkspaceRef = z.infer<typeof accountWorkspaceRefSchema>;

/** Public face of a local account — enough to pick one before unlocking. */
export const accountPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  unlockKind: unlockKindSchema,
  hasAvatar: z.boolean(),
  workspaces: z.array(accountWorkspaceRefSchema)
});
export type AccountPublic = z.infer<typeof accountPublicSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: sessionUserSchema
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(1)
});
export type RefreshInput = z.infer<typeof refreshInputSchema>;

export const logoutInputSchema = z.object({
  refreshToken: z.string().min(1)
});
export type LogoutInput = z.infer<typeof logoutInputSchema>;

export const updateProfileInputSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно").max(120),
  email: z
    .string()
    .trim()
    .max(254)
    .nullable()
    .optional()
    .refine((value) => value == null || value.length === 0 || z.string().email().safeParse(value).success, {
      message: "Введите корректный email"
    })
});
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, "Введите текущий пароль или PIN"),
    newPassword: z.string().min(8, "Новый пароль должен быть не короче 8 символов").max(128).optional(),
    newPin: pinSchema.optional(),
    revokeOtherSessions: z.boolean().default(true)
  })
  .refine((value) => (value.newPassword ? 1 : 0) + (value.newPin ? 1 : 0) === 1, {
    message: "Укажите новый пароль или PIN из 4 цифр",
    path: ["newPassword"]
  })
  .refine((value) => !value.newPassword || value.currentPassword !== value.newPassword, {
    message: "Новый пароль должен отличаться от текущего",
    path: ["newPassword"]
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export const sessionInfoSchema = z.object({
  id: z.string(),
  deviceName: z.string().nullable(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean()
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
