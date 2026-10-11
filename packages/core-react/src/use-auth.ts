"use client";

import { ApiError } from "@orion/core";
import type { LoginInput, RegisterInput, SessionUser } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * The session user shape lives in `@orion/shared-types` (`sessionUserSchema`)
 * — re-exported here so panel code that already imports it from this package
 * keeps working. It used to be a hand-written duplicate, which silently drifted
 * from the contract as soon as the API grew a field.
 */
export type { SessionUser };

/**
 * Thrown by the session queryFn to mean "there is definitely no valid
 * session" (no stored token, or a 401 that survived ApiClient's own
 * refresh-and-retry). Anything else thrown (network failure, 5xx, a thrown
 * non-ApiError) is left as-is and surfaces as `status: "unavailable"` — API
 * unreachability is not the same fact as "logged out" and must not be
 * reported as one.
 */
export class SessionUnauthenticatedError extends Error {}

/**
 * The session queryFn's actual logic, pulled out so it can be unit tested
 * without rendering a hook: given a token getter and the `me()` call, decide
 * whether this is a confirmed logged-out session (throws
 * `SessionUnauthenticatedError`) or something else, which is left to
 * propagate as-is (network failure, 5xx, any other thrown value) so the
 * caller can tell "no session" apart from "couldn't check".
 */
export async function fetchSessionUser(
  tokenStore: { get: () => Promise<string | null> },
  api: { me: () => Promise<SessionUser> },
  clearToken: () => Promise<void>
): Promise<SessionUser> {
  const token = await tokenStore.get();
  if (!token) throw new SessionUnauthenticatedError();
  try {
    return await api.me();
  } catch (error) {
    // ApiClient already tried refreshing internally before this ever
    // surfaces — a 401 here means the session is genuinely dead. A network
    // error (fetch throwing, a transient 500) is not that, and must not wipe
    // the refresh token: that would force a full re-login over a blip the
    // client could otherwise recover from silently.
    if (error instanceof ApiError && error.status === 401) {
      await clearToken();
      throw new SessionUnauthenticatedError();
    }
    throw error;
  }
}

/**
 * Maps a react-query-shaped result for the session query to the honest
 * `SessionResult` discriminated state. Pulled out as a pure function so the
 * state machine (loading / authenticated / unauthenticated / unavailable) is
 * unit-testable without rendering a hook or a QueryClientProvider.
 */
export function deriveSessionResult(
  query: { isLoading: boolean; isSuccess: boolean; data: SessionUser | undefined; error: unknown },
  retry: () => void
): SessionResult {
  if (query.isLoading) {
    return { status: "loading", user: null, isLoading: true, retry };
  }
  if (query.isSuccess) {
    return { status: "authenticated", user: query.data as SessionUser, isLoading: false, retry };
  }
  if (query.error instanceof SessionUnauthenticatedError) {
    return { status: "unauthenticated", user: null, isLoading: false, retry };
  }
  // Unreachable API / non-401 failure — NOT the same fact as logged-out.
  return {
    status: "unavailable",
    user: null,
    previousUser: query.data ?? undefined,
    isLoading: false,
    retry
  };
}

/**
 * Honest session state (see docs/HISTORY.md,
 * "S08: session state"). `loading` and `authenticated`/`unauthenticated` mean
 * what they say. `unavailable` means the API could not be reached or answered
 * with something other than a definitive 401 (network error, 5xx) — it is
 * NOT "logged out": callers must not redirect to /login or offer "create the
 * first account" for it, must not treat `previousUser` as authorization for
 * anything new, and should show a reconnect surface (retry) while leaving
 * whatever the user was doing in place.
 */
export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "unavailable";

export interface SessionResult {
  status: SessionStatus;
  /**
   * @deprecated transitional adapter for pre-S08 consumers that only checked
   * `user`/`isLoading`. Null for every non-authenticated status, INCLUDING
   * `unavailable` — that is intentional (see `previousUser`): a stale user
   * must never be read as "logged in" by code that doesn't check `status`.
   */
  user: SessionUser | null;
  /**
   * Only set when `status === "unavailable"`: the last confirmed session
   * user, kept around so a reconnect banner can say "as <name>" without
   * granting the identity any new authorization — react-query keeps `data`
   * from the last successful fetch even while a refetch is failing, so this
   * needs no separate bookkeeping.
   */
  previousUser?: SessionUser;
  /** @deprecated transitional adapter — use `status === "loading"` */
  isLoading: boolean;
  /** Re-runs the session check. The only way out of `unavailable` besides a successful background refetch. */
  retry: () => void;
}

/**
 * Resolves the current session by checking for a stored token and, if
 * present, confirming it against GET /auth/me.
 *
 * Historically this returned `{ user: SessionUser | null, isLoading }` and
 * folded ANY error — including a transient network failure or a 500 — into
 * `user: null`, i.e. "not logged in". That made a temporary API outage
 * indistinguishable from a fresh install with zero accounts, and every
 * consumer's `!isLoading && !user → router.replace("/login")` effect would
 * fire on it, discarding whatever the user was doing. `status` now
 * distinguishes that case (`unavailable`) from a genuine logged-out session
 * (`unauthenticated`); `user`/`isLoading` remain for callers not yet updated
 * to check `status`, and are false-safe (null/false) rather than
 * false-positive in the unavailable case.
 */
export function useSession(): SessionResult {
  const { api, tokenStore } = useCore();

  const query = useQuery({
    queryKey: ["session"],
    // Manual retry only (via the returned `retry()`) — react-query's own
    // background retries would otherwise hide a genuine outage behind a
    // loading spinner for several seconds before it ever reaches consumers.
    retry: false,
    queryFn: () => fetchSessionUser(tokenStore, api, () => tokenStore.clear())
  });

  // Not memoized: `query.refetch` is already stable per react-query, and
  // wrapping it in useCallback here only invites a stale-closure lint fight
  // over a one-line no-op wrapper.
  const retry = (): void => {
    void query.refetch();
  };

  return deriveSessionResult(query, retry);
}

/**
 * Local user directory for the login picker — not finance `useAccounts`.
 * `enabled` defaults to true; login/register pass `false` once they know
 * they're in server mode (S05) so this never fires a request the server
 * will reject (`GET /auth/accounts` 403s in server mode).
 */
export function useAuthAccounts(enabled = true) {
  const { api } = useCore();
  return useQuery({
    queryKey: ["auth-accounts"],
    queryFn: () => api.listLocalAccounts(),
    enabled
  });
}

/**
 * S05 — public `/system/mode` readout, used by login/register to hide the
 * account-picker/PIN UI in "server" mode instead of showing controls the
 * server will 403/400 on use. Not itself an access boundary (see
 * `orionModeInfoSchema` doc comment) — just UI/server agreement.
 */
export function useOrionMode() {
  const { api } = useCore();
  return useQuery({
    queryKey: ["orion-mode"],
    queryFn: () => api.getOrionMode(),
    staleTime: Infinity
  });
}

export function useLogin() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.login(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    }
  });
}

export function useRegister() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.register(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    }
  });
}

export function useLogout() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.removeQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    }
  });
}

/** Revokes every active session for the user, not just the current device. */
export function useLogoutAll() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logoutAll(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.removeQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    }
  });
}
