"use client";

import { usePreferences, useSession } from "@orion/core-react";
import type { SoundLevel } from "@orion/shared-types";
import { SoundLevelProvider } from "@orion/ui";
import { useEffect, useState, type ReactNode } from "react";

/**
 * The account's «Звуки» level for every component below — mirrors `motion-preference.tsx`.
 * Off by default, including before sign-in and while preferences are still loading: sound is
 * opt-in, so the silent default must hold until the account's own saved choice is known.
 */
export function SoundPreference({ children }: { children: ReactNode }): React.ReactElement {
  const { user } = useSession();
  const [level, setLevel] = useState<SoundLevel>("off");
  useEffect(() => {
    if (!user) setLevel("off");
  }, [user]);
  return (
    <SoundLevelProvider level={level}>
      {user ? <AccountSoundLevel onLevel={setLevel} /> : null}
      {children}
    </SoundLevelProvider>
  );
}

function AccountSoundLevel({ onLevel }: { onLevel: (level: SoundLevel) => void }): null {
  const { data } = usePreferences();
  const level = data?.soundLevel ?? "off";
  useEffect(() => onLevel(level), [level, onLevel]);
  return null;
}
