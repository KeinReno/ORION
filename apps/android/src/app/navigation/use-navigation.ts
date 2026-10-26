import { useCallback, useEffect, useRef, useState } from "react";
import { parseRoute, routeHash, type AppRoute } from "./routes";

export function useNavigation(guard: () => boolean = () => true) {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(location.hash === "#editor" ? history.state?.returnHash ?? "" : location.hash));
  const guardRef = useRef(guard); guardRef.current = guard;
  const lastHash = useRef(location.hash);
  const lastState = useRef(history.state);
  const canLeave = useCallback(() => guardRef.current(), []);
  useEffect(() => {
    const changed = () => {
      if (location.hash === lastHash.current) return;
      if (!canLeave()) { history.pushState(lastState.current, "", lastHash.current); return; }
      lastHash.current = location.hash; lastState.current = history.state;
      if (location.hash !== "#editor") setRoute(parseRoute(location.hash));
    };
    window.addEventListener("popstate", changed); window.addEventListener("hashchange", changed);
    return () => { window.removeEventListener("popstate", changed); window.removeEventListener("hashchange", changed); };
  }, [canLeave]);
  function navigate(next: AppRoute, replace = false) {
    if (!canLeave()) return;
    const hash = routeHash(next);
    if (hash !== location.hash) {
      const state = { appRoute: true, backHash: replace ? history.state?.backHash : location.hash, ...(replace ? history.state : {}) };
      if (replace) history.replaceState(state, "", hash); else history.pushState(state, "", hash);
    }
    lastHash.current = location.hash; lastState.current = history.state;
    setRoute(next);
  }
  function openEditor() {
    history.pushState({ editor: true, returnHash: location.hash }, "", "#editor");
    lastHash.current = location.hash; lastState.current = history.state;
  }
  return { route, navigate, openEditor, canLeave };
}
