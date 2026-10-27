"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";

/**
 * How much the interface sounds — the user's «Звуки» setting, mirrors `motion-level.tsx`.
 * `off` (default — a fresh install is silent until the user opts in): nothing plays.
 * `quiet`: only things the user didn't just trigger themselves (reminders, alerts).
 * `full`: also taps the user did trigger (check, save, permanent delete, sign-in/out).
 * There is no OS-level override here (unlike reduced-motion) — sound is opt-in by nature.
 */
export type SoundLevel = "off" | "quiet" | "full";

const SoundLevelContext = createContext<SoundLevel>("off");

export function SoundLevelProvider({ level, children }: { level: SoundLevel; children: ReactNode }): React.ReactElement {
  return <SoundLevelContext.Provider value={level}>{children}</SoundLevelContext.Provider>;
}

export function useSoundLevel(): SoundLevel {
  return useContext(SoundLevelContext);
}

/**
 * Every sound effect the app can play, and the minimum level at which it is heard. Reminder-style
 * sounds (not triggered by the listener's own click) sit at `quiet`; everything else — a tap the
 * user just made — needs `full`, since it's pure extra feedback, not information.
 */
export const SOUND_REGISTRY = {
  "action.check": { src: "/sounds/action-check.wav", minLevel: "full" },
  "action.save": { src: "/sounds/action-save.wav", minLevel: "full" },
  "action.deletePermanent": { src: "/sounds/action-delete.wav", minLevel: "full" },
  "auth.login": { src: "/sounds/auth-login.wav", minLevel: "full" },
  "auth.logout": { src: "/sounds/auth-logout.wav", minLevel: "full" },
  "notify.reminder": { src: "/sounds/notify-reminder.wav", minLevel: "quiet" }
} as const satisfies Record<string, { src: string; minLevel: Exclude<SoundLevel, "off"> }>;

export type SoundKey = keyof typeof SOUND_REGISTRY;

const LEVEL_RANK: Record<SoundLevel, number> = { off: 0, quiet: 1, full: 2 };

// One HTMLAudioElement per src, shared across every `play()` call in this tab — created lazily so
// nothing touches `Audio`/`document` during SSR, and cheap to re-trigger (rewinds instead of
// allocating), which matters for `action.check` fired in quick succession.
const audioCache = new Map<string, HTMLAudioElement>();

function audioFor(src: string): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let audio = audioCache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    audioCache.set(src, audio);
  }
  return audio;
}

/**
 * `play(key)` — a no-op below the sound's `minLevel`, and never throws: autoplay policies, a
 * missing file or a tab without audio hardware must never break the action that triggered it.
 */
export function useUiSound(): { play: (key: SoundKey) => void } {
  const level = useSoundLevel();
  const levelRef = useRef(level);
  levelRef.current = level;

  return {
    play(key: SoundKey) {
      const spec = SOUND_REGISTRY[key];
      if (LEVEL_RANK[levelRef.current] < LEVEL_RANK[spec.minLevel]) return;
      const audio = audioFor(spec.src);
      if (!audio) return;
      try {
        audio.currentTime = 0;
        void audio.play()?.catch(() => {});
      } catch {
        // Ignore — e.g. a browser that hasn't granted audio-without-interaction yet.
      }
    }
  };
}
