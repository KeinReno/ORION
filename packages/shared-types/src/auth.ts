import { z } from "zod";

export const registerInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов"),
  name: z.string().min(1).max(120)
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string()
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: sessionUserSchema
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
