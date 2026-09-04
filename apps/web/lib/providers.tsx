"use client";

import { BrowserLocalStorage } from "@orion/core";
import { CoreProvider } from "@orion/core-react";
import { useState, type ReactNode } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function Providers({ children }: { children: ReactNode }): React.ReactElement {
  const [storage] = useState(() => new BrowserLocalStorage());
  return (
    <CoreProvider baseUrl={API_BASE_URL} storage={storage}>
      {children}
    </CoreProvider>
  );
}
