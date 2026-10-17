"use client";

import { usePreferences, useSession } from "@orion/core-react";
import { ThemeProvider } from "@orion/ui";
import { effectiveApplicationTheme } from "./effective-application-theme";
import type { ReactNode } from "react";

/** User-global scope, shared by the workbench and detached routes. Panel previews remain nested scopes. */
export function ApplicationTheme({ children }: { children: ReactNode }): React.ReactElement {
  const { user } = useSession();
  return user ? <SignedInTheme>{children}</SignedInTheme> : <>{children}</>;
}

function SignedInTheme({ children }: { children: ReactNode }): React.ReactElement {
  const { data } = usePreferences();
  const precision = data?.theme === "kaiden-precision";
  return <ThemeProvider className="contents" flag={precision ? "kaiden-theme-v1" : undefined}
    definition={effectiveApplicationTheme(data)}>{children}</ThemeProvider>;
}
