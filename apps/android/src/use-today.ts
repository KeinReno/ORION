import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { localDate } from "@orion/mobile-core";

export function useToday() {
  const [today, setToday] = useState(localDate);
  useEffect(() => {
    const refresh = () => setToday(localDate());
    const interval = setInterval(refresh, 15000);
    const midnight = new Date(); midnight.setHours(24, 0, 0, 30);
    const timeout = setTimeout(refresh, Math.max(1, midnight.getTime() - Date.now()));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const listener = Capacitor.isNativePlatform() ? App.addListener("appStateChange", refresh) : null;
    return () => { clearTimeout(timeout); clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); void listener?.then((handle) => handle.remove()); };
  }, [today]);
  return today;
}
