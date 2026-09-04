"use client";

import { createOrionClient, type KeyValueStorage, type OrionClient } from "@orion/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const CoreContext = createContext<OrionClient | null>(null);

export interface CoreProviderProps {
  baseUrl: string;
  storage: KeyValueStorage;
  children: ReactNode;
}

/**
 * Root of the shared frontend core: one OrionClient instance (API + token
 * store) plus a React Query cache, available to every module via useCore().
 */
export function CoreProvider({ baseUrl, storage, children }: CoreProviderProps): React.ReactElement {
  const client = useMemo(() => createOrionClient({ baseUrl, storage }), [baseUrl, storage]);
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 10_000 } }
  }));

  return (
    <CoreContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </CoreContext.Provider>
  );
}

export function useCore(): OrionClient {
  const client = useContext(CoreContext);
  if (!client) {
    throw new Error("useCore() must be used inside <CoreProvider>");
  }
  return client;
}
