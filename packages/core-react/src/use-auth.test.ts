import { ApiError } from "@orion/core";
import { describe, expect, it, vi } from "vitest";
import { deriveSessionResult, fetchSessionUser, SessionUnauthenticatedError } from "./use-auth";
import type { SessionUser } from "@orion/shared-types";

const user: SessionUser = {
  id: "u1",
  name: "Alice",
  email: "alice@example.com",
  unlockKind: "password",
  hasAvatar: false,
  passwordStrength: "strong",
  createdAt: "2026-01-01T00:00:00.000Z"
} as unknown as SessionUser;

describe("fetchSessionUser", () => {
  it("throws SessionUnauthenticatedError when there is no stored token — a genuinely logged-out state", async () => {
    const tokenStore = { get: vi.fn().mockResolvedValue(null) };
    const api = { me: vi.fn() };
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(fetchSessionUser(tokenStore, api, clear)).rejects.toBeInstanceOf(SessionUnauthenticatedError);
    expect(api.me).not.toHaveBeenCalled();
  });

  it("returns the user on success", async () => {
    const tokenStore = { get: vi.fn().mockResolvedValue("tok") };
    const api = { me: vi.fn().mockResolvedValue(user) };
    const clear = vi.fn();

    await expect(fetchSessionUser(tokenStore, api, clear)).resolves.toBe(user);
  });

  it("a confirmed 401 (ApiClient already tried refresh-and-retry) clears the token and reports unauthenticated", async () => {
    const tokenStore = { get: vi.fn().mockResolvedValue("tok") };
    const api = { me: vi.fn().mockRejectedValue(new ApiError(401, "expired")) };
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(fetchSessionUser(tokenStore, api, clear)).rejects.toBeInstanceOf(SessionUnauthenticatedError);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("a network failure (fetch throwing, not an ApiError) is NOT treated as unauthenticated and does not clear the token", async () => {
    const tokenStore = { get: vi.fn().mockResolvedValue("tok") };
    const networkError = new TypeError("Failed to fetch");
    const api = { me: vi.fn().mockRejectedValue(networkError) };
    const clear = vi.fn();

    await expect(fetchSessionUser(tokenStore, api, clear)).rejects.toBe(networkError);
    expect(clear).not.toHaveBeenCalled();
  });

  it("a transient 500 is NOT treated as unauthenticated and does not clear the token", async () => {
    const tokenStore = { get: vi.fn().mockResolvedValue("tok") };
    const serverError = new ApiError(500, "internal error");
    const api = { me: vi.fn().mockRejectedValue(serverError) };
    const clear = vi.fn();

    await expect(fetchSessionUser(tokenStore, api, clear)).rejects.toBe(serverError);
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("deriveSessionResult", () => {
  const retry = vi.fn();

  it("loading", () => {
    const result = deriveSessionResult({ isLoading: true, isSuccess: false, data: undefined, error: undefined }, retry);
    expect(result).toEqual({ status: "loading", user: null, isLoading: true, retry });
  });

  it("authenticated", () => {
    const result = deriveSessionResult({ isLoading: false, isSuccess: true, data: user, error: undefined }, retry);
    expect(result).toEqual({ status: "authenticated", user, isLoading: false, retry });
  });

  it("a SessionUnauthenticatedError maps to status: unauthenticated, not unavailable", () => {
    const result = deriveSessionResult(
      { isLoading: false, isSuccess: false, data: undefined, error: new SessionUnauthenticatedError() },
      retry
    );
    expect(result.status).toBe("unauthenticated");
    expect(result.user).toBeNull();
  });

  it("a network/5xx error maps to status: unavailable, NOT unauthenticated — this is the core S08 fix", () => {
    const result = deriveSessionResult(
      { isLoading: false, isSuccess: false, data: undefined, error: new TypeError("Failed to fetch") },
      retry
    );
    expect(result.status).toBe("unavailable");
    // Must not grant new rights under a stale identity, but also must not
    // claim to be logged out — `user` stays null either way, `status` is
    // the field callers must branch on.
    expect(result.user).toBeNull();
  });

  it("unavailable carries the last known user as previousUser (react-query keeps stale `data` across a failing refetch) without exposing it as `user`", () => {
    const result = deriveSessionResult(
      { isLoading: false, isSuccess: false, data: user, error: new ApiError(500, "boom") },
      retry
    );
    expect(result.status).toBe("unavailable");
    expect(result.user).toBeNull();
    expect(result.previousUser).toBe(user);
  });

  it("retry() from an unavailable state is the same function passed in — callers can wire it to a reconnect button", () => {
    const result = deriveSessionResult(
      { isLoading: false, isSuccess: false, data: undefined, error: new Error("boom") },
      retry
    );
    result.retry();
    expect(retry).toHaveBeenCalled();
  });
});
