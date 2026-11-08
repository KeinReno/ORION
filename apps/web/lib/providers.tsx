"use client";

import { BrowserLocalStorage } from "@orion/core";
import { CoreProvider, setReplicaStorage } from "@orion/core-react";
import { useQueryClient } from "@tanstack/react-query";
import { ContextMenuProvider, ToastProvider } from "@orion/ui";
import { useEffect, useState, type ReactNode } from "react";
import { applyBootSnapshot, attachBootSnapshot, bootLocalStorage } from "./boot-snapshot";
import { API_BASE_URL, isLoopbackHost } from "./api-base";
import { PHONE_DEVICE_TOKEN_KEY } from "../phone/phone-device";
import { CrossWindowSync } from "./cross-window-sync-provider";
import { NamespacedStorage, nodeStoragePrefix, readNodeMark } from "./node-mode";
import { PreferencesEffect } from "./preferences-effect";
import { createIdbReplicaStorage } from "./replica-idb";
import { ApplicationTheme } from "./application-theme";
import { MotionPreference } from "./motion-preference";
import { SoundPreference } from "./sound-preference";
import { NotificationSoundBridge } from "./notification-sound-bridge";
import { RuntimeExtensions } from "./extensions/runtime/runtime-extensions";

function BootSnapshotPersist(): null {
  const client = useQueryClient();
  useEffect(() => {
    const storage = bootLocalStorage();
    if (!storage) return;
    applyBootSnapshot(client, storage);
    return attachBootSnapshot(client, storage);
  }, [client]);
  return null;
}

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
      <BootSnapshotPersist />
      {/* Inside CoreProvider (it needs the API client) and gated on a session,
          so the login screen never fires a doomed preferences request. */}
      <PreferencesEffect />
      <CrossWindowSync />
      {/* Extensions from the folder (ADR-0022): loads approved ones into this window; renders nothing. */}
      <RuntimeExtensions />
      <MotionPreference>
        <SoundPreference>
          <NotificationSoundBridge />
          <ApplicationTheme><ToastProvider><ContextMenuProvider>{children}</ContextMenuProvider></ToastProvider></ApplicationTheme>
        </SoundPreference>
      </MotionPreference>
    </CoreProvider>
  );
}
