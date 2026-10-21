export const SETTINGS_PAGE_IDS = ["appearance", "motion", "voice", "data", "updates", "diagnostics", "about"] as const;
export type SettingsPageId = typeof SETTINGS_PAGE_IDS[number];
export type AppRoute =
  | { kind: "module"; moduleId: string; scope?: string; entityId?: string }
  | { kind: "settings"; page?: SettingsPageId; field?: string; query?: string }
  | { kind: "connection" }
  | { kind: "more" };

export function routeHash(route: AppRoute): string {
  if (route.kind === "module") return "#/" + (route.scope ? "scope/" + encodeURIComponent(route.scope) + "/" : "") + "module/" + encodeURIComponent(route.moduleId) + (route.entityId ? "?entity=" + encodeURIComponent(route.entityId) : "");
  if (route.kind !== "settings") return "#/" + route.kind;
  const params = new URLSearchParams();
  if (route.field) params.set("field", route.field);
  if (route.query) params.set("q", route.query);
  return "#/settings" + (route.page ? "/" + route.page : "") + (params.toString() ? "?" + params : "");
}
export function parseRoute(hash: string): AppRoute {
  const [path, search = ""] = hash.replace(/^#\/?/, "").split("?");
  if (path.startsWith("scope/")) {
    const parts = path.split("/");
    if (parts.length !== 4 || parts[2] !== "module" || !(parts[1] === "phone" || /^[a-f0-9]{64}$/.test(parts[1]))) return { kind: "module", moduleId: "unavailable" };
    try { return { kind: "module", moduleId: decodeURIComponent(parts[3]), scope: parts[1], ...(new URLSearchParams(search).get("entity") ? { entityId: new URLSearchParams(search).get("entity")! } : {}) }; } catch { return { kind: "module", moduleId: "unavailable" }; }
  }
  if (path === "connection" || path === "more") return { kind: path };
  if (path === "settings" || path.startsWith("settings/")) {
    const page = path.split("/")[1];
    const params = new URLSearchParams(search);
    return { kind: "settings", ...(SETTINGS_PAGE_IDS.includes(page as SettingsPageId) ? { page: page as SettingsPageId } : {}),
      ...(params.get("field") ? { field: params.get("field")!.slice(0, 100) } : {}),
      ...(params.get("q") ? { query: params.get("q")!.slice(0, 100) } : {}) };
  }
  if (path.startsWith("module/")) {
    try { return { kind: "module", moduleId: decodeURIComponent(path.slice(7)), ...(new URLSearchParams(search).get("entity") ? { entityId: new URLSearchParams(search).get("entity")! } : {}) }; } catch { /* malformed URL uses safe default */ }
  }
  return { kind: "module", moduleId: "tasks" };
}
