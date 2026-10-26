import { useRef, useState } from "react";
import type { MobileRepository, MobileSettings, MobileSnapshot } from "@orion/mobile-core";

export function useSettingWrites(repository: MobileRepository | null, publish: (value: MobileSnapshot) => void) {
  const writes = useRef(new Set<keyof MobileSettings>());
  const [pending, setPending] = useState<Partial<Record<keyof MobileSettings, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof MobileSettings, string>>>({});
  const [saved, setSaved] = useState<Partial<Record<keyof MobileSettings, boolean>>>({});
  const [drafts, setDrafts] = useState<Partial<MobileSettings>>({});
  async function patch(change: Partial<MobileSettings>): Promise<boolean> {
    if (!repository) return false;
    const keys = Object.keys(change) as (keyof MobileSettings)[];
    if (keys.some((key) => writes.current.has(key))) return false;
    keys.forEach((key) => writes.current.add(key));
    setSaved((value) => ({ ...value, ...Object.fromEntries(keys.map((key) => [key, false])) }));
    setDrafts((value) => ({ ...value, ...change }));
    setPending((value) => ({ ...value, ...Object.fromEntries(keys.map((key) => [key, true])) }));
    setErrors((value) => ({ ...value, ...Object.fromEntries(keys.map((key) => [key, ""])) }));
    try {
      await repository.patchSettings(change); publish(repository.snapshot());
      setDrafts((value) => { const next = { ...value }; keys.forEach((key) => delete next[key]); return next; });
      setSaved((value) => ({ ...value, ...Object.fromEntries(keys.map((key) => [key, true])) }));
      return true;
    } catch {
      setErrors((value) => ({ ...value, ...Object.fromEntries(keys.map((key) => [key, "Не удалось сохранить настройку. Повторите — выбранное значение осталось здесь."])) }));
      return false;
    } finally {
      keys.forEach((key) => writes.current.delete(key));
      setPending((value) => ({ ...value, ...Object.fromEntries(keys.map((key) => [key, false])) }));
    }
  }
  return { pending, errors, drafts, saved, patch };
}
