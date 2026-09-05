"use client";

import { ApiError } from "@orion/core";
import type { LoginInput, RegisterInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Resolves the current session by checking for a stored token and, if
 * present, confirming it against GET /auth/me. Returns null (not loading)
 * once resolved with no valid session, so callers can redirect to /login.
 */
export function useSession(): { user: SessionUser | null; isLoading: boolean } {
  const { api, tokenStore } = useCore();

  const query = useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionUser | null> => {
      const token = await tokenStore.get();
      if (!token) return null;
      try {
        return await api.me();
      } catch (error) {
        // ApiClient already tried refreshing internally before this ever
        // surfaces — a 401 here means the session is genuinely dead. A
        // network error (fetch throwing, a transient 500) is not that, and
        // must not wipe the refresh token: that would force a full re-login
        // over a blip the client could otherwise recover from silently.
        if (error instanceof ApiError && error.status === 401) {
          await tokenStore.clear();
        }
        return null;
      }
    }
  });

  return { user: query.data ?? null, isLoading: query.isLoading };
}

export function useLogin() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.login(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session"] })
  });
}

export function useRegister() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.register(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session"] })
  });
}

export function useLogout() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session"] })
  });
}

/** Revokes every active session for the user, not just the current device. */
export function useLogoutAll() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logoutAll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session"] })
  });
}
