"use client";

import { BrowserLocalStorage } from "@orion/core";
import { CoreProvider, setReplicaStorage } from "@orion/core-react";
import { ToastProvider } from "@orion/ui";
import { useState, type ReactNode } from "react";
import { API_BASE_URL } from "./api-base";
import { CrossWindowSync } from "./cross-window-sync-provider";
import { NamespacedStorage, nodeStoragePrefix, readNodeMark } from "./node-mode";
import { PreferencesEffect } from "./preferences-effect";
import { createIdbReplicaStorage } from "./replica-idb";

export function Providers({ children }: { children: ReactNode }): React.ReactElement {
  // ТЗ-06: локальная копия гибридных пространств лежит в IndexedDB (если она доступна).
  useState(() => {
    if (typeof window !== "undefined") setReplicaStorage(createIdbReplicaStorage());
    return null;
  });
  const [storage] = useState(() => new NamespacedStorage(new BrowserLocalStorage(), nodeStoragePrefix(readNodeMark())));
  return (
    <CoreProvider baseUrl={API_BASE_URL} storage={storage}>
      {/* Inside CoreProvider (it needs the API client) and gated on a session,
          so the login screen never fires a doomed preferences request. */}
      <PreferencesEffect />
      <CrossWindowSync />
      <ToastProvider>{children}</ToastProvider>
    </CoreProvider>
  );
}
