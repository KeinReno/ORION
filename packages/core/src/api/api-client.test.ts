import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./api-client";
import { TokenStore } from "../auth/token-store";
import { MemoryStorage } from "../storage/storage-adapter";

// Focus: the 401 -> /auth/refresh -> retry-once path in ApiClient.request(),
// the single most bug-prone piece of client logic (see docs/HISTORY.md v0.3).

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
  blob?: () => Promise<Blob>;
}

function json(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (body === undefined ? "" : JSON.stringify(body))
  };
}

function blobResponse(status: number, body: string): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (status >= 200 && status < 300 ? "" : body),
    blob: async () => new Blob([body])
  };
}

// A contract-complete auth response: `/auth/refresh` is parsed with
// `authResponseSchema`, which (deliberately) has no defaults — a mock that
// omits `passwordStrength`/`passwordChangedAt` is an invalid response and the
// client is right to reject it.
const AUTH_OK = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
  user: {
    id: "u1",
    email: "kai@orion.dev",
    name: "KAI",
    unlockKind: "password",
    hasAvatar: false,
    passwordStrength: 3,
    passwordChangedAt: null
  }
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

  it("does not set a JSON Content-Type when the body is FormData (multipart upload)", async () => {
    fetchMock.mockResolvedValueOnce(json(200, []));

    await makeClient().uploadDocuments("w1", null, [new File(["hi"], "a.txt", { type: "text/plain" })]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/workspaces/w1/documents/upload");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer access-1");
  });

  it("requestBlob returns the raw body and follows the 401 -> refresh -> retry path", async () => {
    fetchMock
      .mockResolvedValueOnce(blobResponse(401, "expired")) // GET .../content
      .mockResolvedValueOnce(json(200, AUTH_OK)) // POST /auth/refresh
      .mockResolvedValueOnce(blobResponse(200, "file-bytes")); // retry

    const blob = await makeClient().getDocumentBlob("w1", "d1");

    expect(await blob.text()).toBe("file-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("http://api.test/auth/refresh");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer access-2");
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

describe("ApiClient sync contract", () => {
  it("uses workspace-scoped routes and validates backup responses", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, null))
      .mockResolvedValueOnce(json(200, [{ name: "snapshot.orion", sizeBytes: 42, createdAt: "2026-09-09T10:00:00.000Z" }]))
      .mockResolvedValueOnce(
        json(200, {
          snapshot: "snapshot.orion",
          createdAt: "2026-09-09T10:00:00.000Z",
          incoming: { notes: 1 },
          current: { notes: 0 },
          applied: false,
          // S04 stale-preview rejection: preview always carries a manifestHash
          // the client must echo back as `expectedManifestHash` on apply.
          manifestHash: "deadbeef"
        })
      );

    const client = makeClient();
    expect(await client.getSyncRemote("w1")).toBeNull();
    expect(await client.listBackups("w1")).toHaveLength(1);
    expect(await client.restoreBackup("w1", { snapshot: "snapshot.orion", dryRun: true })).toMatchObject({ applied: false });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://api.test/workspaces/w1/sync/remote",
      "http://api.test/workspaces/w1/sync/backups",
      "http://api.test/workspaces/w1/sync/restore"
    ]);
  });
});
