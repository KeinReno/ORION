import type { KeyValueStorage } from "../storage/storage-adapter";

const ACCESS_TOKEN_KEY = "orion.auth.accessToken";
const REFRESH_TOKEN_KEY = "orion.auth.refreshToken";

export class TokenStore {
  constructor(private readonly storage: KeyValueStorage) {}

  get(): Promise<string | null> {
    return this.storage.get(ACCESS_TOKEN_KEY);
  }

  set(token: string): Promise<void> {
    return this.storage.set(ACCESS_TOKEN_KEY, token);
  }

  getRefreshToken(): Promise<string | null> {
    return this.storage.get(REFRESH_TOKEN_KEY);
  }

  setRefreshToken(token: string): Promise<void> {
    return this.storage.set(REFRESH_TOKEN_KEY, token);
  }

  async setPair(accessToken: string, refreshToken: string): Promise<void> {
    await this.set(accessToken);
    await this.setRefreshToken(refreshToken);
  }

  async clear(): Promise<void> {
    await this.storage.remove(ACCESS_TOKEN_KEY);
    await this.storage.remove(REFRESH_TOKEN_KEY);
  }
}
