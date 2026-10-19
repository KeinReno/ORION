"use client";

import { usePreferences, useSession } from "@orion/core-react";
import type { MotionLevel } from "@orion/shared-types";
import { MotionLevelProvider } from "@orion/ui";
import { useEffect, useState, type ReactNode } from "react";

/**
 * The account's «Анимации» level for every component below. Before sign-in (and while the
 * preferences load) the calm default applies; the OS "reduce motion" switch still wins.
 *
 * The tree shape never changes with the session: `children` always sits in the same place under
 * the same provider, and only the invisible reader beside it comes and goes. Swapping wrappers on
 * sign-in would unmount and remount the whole app (login form, toasts, an opening panel window).
 * The reader is mounted only with a session, so the login screen never asks for preferences.
 */
export function MotionPreference({ children }: { children: ReactNode }): React.ReactElement {
  const { user } = useSession();
  const [level, setLevel] = useState<MotionLevel>("calm");
  useEffect(() => {
    if (!user) setLevel("calm");
  }, [user]);
  return (
    <MotionLevelProvider level={level}>
      {user ? <AccountMotionLevel onLevel={setLevel} /> : null}
      {children}
    </MotionLevelProvider>
  );
}

function AccountMotionLevel({ onLevel }: { onLevel: (level: MotionLevel) => void }): null {
  const { data } = usePreferences();
  const level = data?.motionLevel ?? "calm";
  useEffect(() => onLevel(level), [level, onLevel]);
  return null;
}
