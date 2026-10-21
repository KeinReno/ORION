import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import type { MobileSettings } from "@orion/mobile-core";
import { updater, type UpdateState } from "./updates";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
export function useUpdates(settings: MobileSettings | undefined) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [phase, setPhase] = useState<"idle" | "check" | "download" | "install">("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [percent, setPercent] = useState(0);
  const busy = useRef(false);
  const preferences = useRef(settings);
  preferences.current = settings;
  const lastAttempt = useRef(0);
  const settingsReady = settings !== undefined;

  const download = useCallback(async (wifiOnly = false) => {
    if (busy.current) return;
    busy.current = true; setPhase("download"); setError(""); setMessage(""); setPercent(0);
    try { setState(await updater.download(wifiOnly)); setMessage("APK проверен и готов к установке."); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось скачать обновление. Повторите."); }
    finally { busy.current = false; setPhase("idle"); }
  }, []);

  const check = useCallback(async (automatic = false) => {
    if (busy.current) return;
    if (automatic && (!preferences.current?.autoCheckUpdates || Date.now() - lastAttempt.current < CHECK_INTERVAL)) return;
    busy.current = true; setPhase("check"); setError(""); setMessage("");
    lastAttempt.current = Date.now();
    let result: UpdateState | null = null;
    try {
      result = await updater.check(); setState(result);
      if (!result.available) setMessage("Установлена актуальная версия.");
    } catch { setError("Не удалось проверить обновления. Проверьте интернет и повторите. Локальные записи доступны."); }
    finally { busy.current = false; setPhase("idle"); }
    if (result?.available && !result.ready && result.wifi && preferences.current?.downloadUpdatesOnWifi) {
      await download(true);
    }
  }, [download]);

  useEffect(() => {
    if (!settingsReady) return;
    let active = true;
    const resume = async () => {
      if (busy.current) return;
      try {
        const next = await updater.getState();
        if (!active) return;
        setState(next);
        lastAttempt.current = Math.max(lastAttempt.current, next.lastAttempt);
        await check(true);
      } catch { if (active) setError("Сведения об обновлении недоступны. Попробуйте проверить вручную."); }
    };
    void resume();
    const progress = updater.listen(({ received, total }) => {
      if (active) setPercent(Math.max(0, Math.min(100, Math.round(received / total * 100))));
    });
    const app = Capacitor.isNativePlatform() ? NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void resume();
    }) : null;
    return () => { active = false; void progress.then((handle) => handle.remove()); void app?.then((handle) => handle.remove()); };
  }, [settingsReady, check]);

  const install = async () => {
    if (busy.current) return;
    busy.current = true; setPhase("install"); setError("");
    try {
      const result = await updater.install();
      setMessage(result.status === "permission"
        ? "Разрешите установку обновлений для Orion в открывшихся настройках Android, затем вернитесь и нажмите «Установить обновление»."
        : "Открыт установщик Android. Подтвердите обновление. Если вы отменили установку, её можно запустить снова.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось открыть установщик Android. Повторите."); }
    finally { busy.current = false; setPhase("idle"); }
  };
  return { state, phase, error, message, percent, check, download, install };
}
