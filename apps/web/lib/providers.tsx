"use client";

import { BrowserLocalStorage } from "@orion/core";
import { CoreProvider, setReplicaStorage } from "@orion/core-react";
import { ToastProvider } from "@orion/ui";
import { useState, type ReactNode } from "react";
import { API_BASE_URL, isLoopbackHost } from "./api-base";
import { PHONE_DEVICE_TOKEN_KEY } from "../phone/phone-device";
import { CrossWindowSync } from "./cross-window-sync-provider";
import { NamespacedStorage, nodeStoragePrefix, readNodeMark } from "./node-mode";
import { PreferencesEffect } from "./preferences-effect";
import { createIdbReplicaStorage } from "./replica-idb";
import { ApplicationTheme } from "./application-theme";
import { MotionPreference } from "./motion-preference";
import { RuntimeExtensions } from "./extensions/runtime/runtime-extensions";

/** Токен устройства, которым телефон подтвердил себя на узле. На этом компьютере заголовок не нужен. */
function phoneDeviceHeaders(): Record<string, string> {
  if (typeof window === "undefined" || isLoopbackHost(window.location.hostname)) return {};
  try {
    const token = localStorage.getItem(PHONE_DEVICE_TOKEN_KEY);
    return token ? { "x-orion-device": token } : {};
  } catch {
    return {};
  }
}

export function Providers({ children }: { children: ReactNode }): React.ReactElement {
  // ТЗ-06: локальная копия гибридных пространств лежит в IndexedDB (если она доступна).
  useState(() => {
    if (typeof window !== "undefined") setReplicaStorage(createIdbReplicaStorage());
    return null;
  });
  const [storage] = useState(() => new NamespacedStorage(new BrowserLocalStorage(), nodeStoragePrefix(readNodeMark())));
  return (
    <CoreProvider baseUrl={API_BASE_URL} storage={storage} extraHeaders={phoneDeviceHeaders}>
      {/* Inside CoreProvider (it needs the API client) and gated on a session,
          so the login screen never fires a doomed preferences request. */}
      <PreferencesEffect />
      <CrossWindowSync />
      {/* Extensions from the folder (ADR-0022): loads approved ones into this window; renders nothing. */}
      <RuntimeExtensions />
      <MotionPreference>
        <ApplicationTheme><ToastProvider>{children}</ToastProvider></ApplicationTheme>
      </MotionPreference>
    </CoreProvider>
  );
}
