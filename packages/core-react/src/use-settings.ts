"use client";

import type {
  AppInfo,
  ChangePasswordInput,
  SaveThemeInput,
  SessionInfo,
  SessionUser,
  UpdateProfileInput,
  UpdateUserPreferenceInput,
  UserPreference
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * v0.14 «Настройки». Every hook here is **user-scoped**, not
 * workspace-scoped: the API routes live under `/settings/*` and `/auth/*`
 * (not `/workspaces/:id/...`), so `queryKey` carries no workspace id and the
 * panel never needs `useActiveWorkspace()`. Keep it that way — adding a
 * workspace to these keys would silently fork the cache per workspace for
 * data that has exactly one value per user.
 */

/** The signed-in user's preferences; GET /settings/preferences upserts a default row server-side. */
export function usePreferences() {
  const { api } = useCore();
  return useQuery<UserPreference>({
    queryKey: ["preferences"],
    queryFn: () => api.getPreferences()
  });
}

/**
 * PATCH /settings/preferences. `UpdateUserPreferenceInput` is the settings
 * schema `.partial()`, so a form only has to send the fields it actually
 * changed — the server merges the rest.
 */
export function useUpdatePreferences() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<UserPreference, Error, UpdateUserPreferenceInput>({
    mutationFn: (input) => api.updatePreferences(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["preferences"] })
  });
}

/**
 * Own theme library. Both write the preference cache from the response directly, so the active palette and
 * the list change together, without a second request in between that could flash the previous palette.
 */
export function useSaveTheme() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<UserPreference, Error, SaveThemeInput>({
    mutationFn: (input) => api.saveTheme(input),
    onSuccess: (preference) => queryClient.setQueryData(["preferences"], preference)
  });
}

export function useDeleteTheme() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<UserPreference, Error, string>({
    mutationFn: (themeId) => api.deleteTheme(themeId),
    onSuccess: (preference) => queryClient.setQueryData(["preferences"], preference)
  });
}

/** Name/version of the running API plus its environment — read-only, never cached for long. */
export function useAppInfo() {
  const { api } = useCore();
  return useQuery<AppInfo>({
    queryKey: ["app-info"],
    queryFn: () => api.getAppInfo()
  });
}

/** PATCH /auth/profile. Invalidate `["session"]` so the sidebar/header pick the new name up. */
export function useUpdateProfile() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<SessionUser, Error, UpdateProfileInput>({
    mutationFn: (input) => api.updateProfile(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    }
  });
}

export function useUploadAvatar() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: Blob) => api.uploadAvatar(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    }
  });
}

export function useDeleteAvatar() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteAvatar(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    }
  });
}

/**
 * POST /auth/change-password. Touches two caches: `["session"]` (the user
 * row carries `passwordChangedAt`/`passwordStrength`) and `["sessions"]`,
 * because `revokeOtherSessions` kills the other devices server-side and the
 * device list on screen would otherwise be stale.
 */
export function useChangePassword() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<SessionUser, Error, ChangePasswordInput>({
    mutationFn: (input) => api.changePassword(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    }
  });
}

/** Active sessions (devices) for the current user; exactly one has `current: true`. */
export function useSessions() {
  const { api } = useCore();
  return useQuery<SessionInfo[]>({
    queryKey: ["sessions"],
    queryFn: () => api.listSessions()
  });
}

/** Revoke one session by id — the list is the only thing that changes. */
export function useRevokeSession() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (sessionId) => api.revokeSession(sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] })
  });
}
