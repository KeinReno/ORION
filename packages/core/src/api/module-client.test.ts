import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient, ApiError } from "./api-client";
import { createModuleClient, workspaceModuleBase } from "./module-client";
import { TokenStore } from "../auth/token-store";
import { MemoryStorage } from "../storage/storage-adapter";

const reply = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `HTTP ${status}`,
  text: async () => (body === undefined ? "" : JSON.stringify(body))
});

const AUTH_OK = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
  user: { id: "u1", email: "kai@orion.dev", name: "KAI", unlockKind: "password", hasAvatar: false, passwordStrength: 3, passwordChangedAt: null }
};

let fetchMock: ReturnType<typeof vi.fn>;
let store: TokenStore;

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  store = new TokenStore(new MemoryStorage());
  await store.setPair("access-1", "refresh-1");
});

const pet = z.object({ id: z.string(), name: z.string() });

describe("createModuleClient (G24)", () => {
  it("строит путь от корня модуля, шлёт тело и проверяет ответ схемой", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, [{ id: "p1", name: "Барсик" }])).mockResolvedValueOnce(reply(201, { id: "p2", name: "Рыжик" }));
    const api = new ApiClient({ baseUrl: "http://api.test", tokenStore: store });
    const client = createModuleClient(api, workspaceModuleBase("w1", "pet-care"));

    expect(await client.get("/pets", pet.array())).toEqual([{ id: "p1", name: "Барсик" }]);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/workspaces/w1/pet-care/pets");

    expect(await client.post("/pets", { name: "Рыжик" }, pet)).toEqual({ id: "p2", name: "Рыжик" });
    const init = fetchMock.mock.calls[1]![1] as { method: string; body: string; headers: Record<string, string> };
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Рыжик" });
    expect(init.headers.Authorization).toBe("Bearer access-1");
  });

  it("при 401 обновляет токен и повторяет запрос, как остальные методы ApiClient", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(401, { message: "expired" }))
      .mockResolvedValueOnce(reply(200, AUTH_OK))
      .mockResolvedValueOnce(reply(200, { id: "p1", name: "Барсик" }));
    const client = createModuleClient(new ApiClient({ baseUrl: "http://api.test", tokenStore: store }), "/workspaces/w1/pet-care");
    expect(await client.patch("/pets/p1", { name: "Барсик" }, pet)).toEqual({ id: "p1", name: "Барсик" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2]![1] as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer access-2");
  });

  it("ответ не по схеме и ошибка сервера — ошибки, а не молчаливые данные", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: 1 })).mockResolvedValueOnce(reply(409, { message: "Модуль выключен" }));
    const client = createModuleClient(new ApiClient({ baseUrl: "http://api.test", tokenStore: store }), "/workspaces/w1/pet-care");
    await expect(client.get("/pets/p1", pet)).rejects.toThrow();
    await expect(client.delete("/pets/p1", z.void())).rejects.toBeInstanceOf(ApiError);
  });
});
