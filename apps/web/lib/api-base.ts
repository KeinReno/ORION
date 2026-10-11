const LOCAL_API_URL = "http://localhost:4000";

interface ApiBaseContext {
  /** `process.env.NEXT_PUBLIC_API_URL` — inlined by Next at build time. */
  envUrl: string | undefined;
  /** `window.location` in a browser; `null` during SSR/prerender, where nothing is fetched. */
  location: { protocol: string; hostname: string } | null;
  production: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "tauri.localhost"]);
const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(host.toLowerCase()) || /^127\./.test(host) || host === "0.0.0.0";

/**
 * The localhost fallback is only right when the page itself is served from this
 * machine (dev server, the Tauri window, the demo launcher). A production build
 * opened from another machine that silently talked to *its own* `localhost:4000`
 * would look like a dead server, so that case fails loudly instead. SSR and
 * prerender never fetch, so they keep the fallback and the build still passes.
 */
export function resolveApiBaseUrl({ envUrl, location, production }: ApiBaseContext): string {
  const configured = envUrl?.trim().replace(/\/+$/, "");
  if (configured) {
    if (production && location && !isLoopbackHost(location.hostname) && location.protocol !== "tauri:") {
      let apiHost: string;
      try {
        apiHost = new URL(configured).hostname;
      } catch {
        throw new Error("NEXT_PUBLIC_API_URL должен быть абсолютным URL ORION API.");
      }
      if (isLoopbackHost(apiHost)) {
        throw new Error("NEXT_PUBLIC_API_URL указывает на localhost: удалённый клиент обратится к своему компьютеру. Соберите веб-клиент с публичным адресом API.");
      }
    }
    return configured;
  }
  if (!production || !location) return LOCAL_API_URL;
  if (isLoopbackHost(location.hostname) || location.protocol === "tauri:") return LOCAL_API_URL;
  throw new Error(
    "NEXT_PUBLIC_API_URL не задан: веб-клиент не знает адрес ORION API. Задайте его при сборке (см. docs/DEPLOYMENT_READINESS.md)."
  );
}

export const API_BASE_URL = resolveApiBaseUrl({
  envUrl: process.env.NEXT_PUBLIC_API_URL,
  location: typeof window === "undefined" ? null : window.location,
  production: process.env.NODE_ENV === "production"
});

export function accountAvatarUrl(userId: string, bust?: number): string {
  const query = bust != null ? `?t=${bust}` : "";
  return `${API_BASE_URL}/auth/accounts/${userId}/avatar${query}`;
}
