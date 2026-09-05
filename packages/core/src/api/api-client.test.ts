import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./api-client";
import { TokenStore } from "../auth/token-store";
import { MemoryStorage } from "../storage/storage-adapter";

// Focus: the 401 -> /auth/refresh -> retry-once path in ApiClient.request(),
// the single most bug-prone piece of client logic (see docs/PLAN.md v0.3).

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
}

function json(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (body === undefined ? "" : JSON.stringify(body))
  };
}

const AUTH_OK = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
  user: { id: "u1", email: "kai@orion.dev", name: "KAI" }
};

let fetchMock: ReturnType<typeof vi.fn>;
let store: TokenStore;

function makeClient(): ApiClient {
  return new ApiClient({ baseUrl: "http://api.test", tokenStore: store });
}

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  store = new TokenStore(new MemoryStorage());
  await store.setPair("access-1", "refresh-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient 401 handling", () => {
  it("refreshes the token pair and retries the original request once", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: "expired" })) // GET /tasks
      .mockResolvedValueOnce(json(200, AUTH_OK)) // POST /auth/refresh
      .mockResolvedValueOnce(json(200, [])); // GET /tasks retry

    const result = await makeClient().listTasks("w1");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [, refreshCall, retryCall] = fetchMock.mock.calls;
    expect(refreshCall[0]).toBe("http://api.test/auth/refresh");
    expect(JSON.parse(refreshCall[1].body)).toEqual({ refreshToken: "refresh-1" });

    // rotated pair is persisted, and the retry carries the new access token
    expect(await store.get()).toBe("access-2");
    expect(await store.getRefreshToken()).toBe("refresh-2");
    expect(retryCall[1].headers.Authorization).toBe("Bearer access-2");
  });

  it("clears tokens and throws when the refresh itself fails", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: "expired" })) // GET /tasks
      .mockResolvedValueOnce(json(401, { message: "bad refresh" })); // POST /auth/refresh

    await expect(makeClient().listTasks("w1")).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await store.get()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
  });

  it("does not attempt a refresh for a 401 on /auth/login", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: "wrong password" }));

    await expect(
      makeClient().login({ email: "kai@orion.dev", password: "nope" })
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/auth/login");
  });

  it("shares one /auth/refresh call between concurrent 401s (single-flight)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/auth/refresh")) return json(200, AUTH_OK);
      // every /tasks call 401s until a refresh has happened; simplest is to
      // 401 the first hit per call and 200 the retry
      return json(200, []);
    });
    // first two calls (the concurrent originals) must 401
    fetchMock
      .mockResolvedValueOnce(json(401, { message: "expired" }))
      .mockResolvedValueOnce(json(401, { message: "expired" }));

    const client = makeClient();
    const [a, b] = await Promise.all([client.listTasks("w1"), client.listTasks("w1")]);

    expect(a).toEqual([]);
    expect(b).toEqual([]);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });
});
