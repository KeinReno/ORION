import type { KeyValueStorage } from "../storage/storage-adapter";

const ACCESS_TOKEN_KEY = "orion.auth.accessToken";

export class TokenStore {
  constructor(private readonly storage: KeyValueStorage) {}

  get(): Promise<string | null> {
    return this.storage.get(ACCESS_TOKEN_KEY);
  }

  set(token: string): Promise<void> {
    return this.storage.set(ACCESS_TOKEN_KEY, token);
  }

  clear(): Promise<void> {
    return this.storage.remove(ACCESS_TOKEN_KEY);
  }
}
