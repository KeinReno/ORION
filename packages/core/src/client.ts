import { ApiClient } from "./api/api-client";
import { TokenStore } from "./auth/token-store";
import type { KeyValueStorage } from "./storage/storage-adapter";

export interface OrionClient {
  api: ApiClient;
  tokenStore: TokenStore;
}

export function createOrionClient(options: {
  baseUrl: string;
  storage: KeyValueStorage;
  extraHeaders?: () => Record<string, string>;
}): OrionClient {
  const tokenStore = new TokenStore(options.storage);
  const api = new ApiClient({ baseUrl: options.baseUrl, tokenStore, extraHeaders: options.extraHeaders });
  return { api, tokenStore };
}
