import { describe, expect, it } from "vitest";
import { TokenStore } from "./token-store";
import { MemoryStorage } from "../storage/storage-adapter";

describe("TokenStore", () => {
  it("keeps access and refresh tokens under separate keys", async () => {
    const storage = new MemoryStorage();
    const store = new TokenStore(storage);

    await store.setPair("access-1", "refresh-1");

    expect(await store.get()).toBe("access-1");
    expect(await store.getRefreshToken()).toBe("refresh-1");
    expect(await storage.get("orion.auth.accessToken")).toBe("access-1");
    expect(await storage.get("orion.auth.refreshToken")).toBe("refresh-1");
  });

  it("clear() removes both tokens", async () => {
    const store = new TokenStore(new MemoryStorage());
    await store.setPair("a", "r");

    await store.clear();

    expect(await store.get()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
  });
});
