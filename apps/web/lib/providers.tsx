"use client";

import { BrowserLocalStorage } from "@orion/core";
import { CoreProvider } from "@orion/core-react";
import { ToastProvider } from "@orion/ui";
import { useState, type ReactNode } from "react";
import { PreferencesEffect } from "./preferences-effect";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function Providers({ children }: { children: ReactNode }): React.ReactElement {
  const [storage] = useState(() => new BrowserLocalStorage());
  return (
    <CoreProvider baseUrl={API_BASE_URL} storage={storage}>
      {/* Inside CoreProvider (it needs the API client) and gated on a session,
          so the login screen never fires a doomed preferences request. */}
      <PreferencesEffect />
      <ToastProvider>{children}</ToastProvider>
    </CoreProvider>
  );
}
