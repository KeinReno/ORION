import { Capacitor, registerPlugin } from "@capacitor/core";
import { z } from "zod";
import { accountPublicSchema, lanNodeCardSchema, sessionUserSchema, workspaceSchema,
  lanDiscoveredNodeSchema,
  replicaSnapshotSchema, replicaPullSchema, pushSyncOpsResultSchema, syncModeStateSchema } from "@orion/shared-types";
import type { SyncTransport } from "@orion/core";

const lanStateSchema = z.object({
  paired: z.boolean(), node: lanNodeCardSchema.nullable(), user: sessionUserSchema.nullable(),
  address: z.string(), port: z.number().int(),
});
export type LanState = z.infer<typeof lanStateSchema>;
export type Pairing = { code: string; expiresAt: string; node: z.infer<typeof lanNodeCardSchema>; status: string };
interface LanNative {
  getState(): Promise<LanState>;
  discover(): Promise<{ nodes: unknown[] }>;
  reconnect(input: { address: string; port: number }): Promise<LanState>;
  beginPairing(input: { address: string; port: number }): Promise<Pairing>;
  pollPairing(): Promise<{ status: string }>;
  accounts(): Promise<{ status: number; body: unknown }>;
  login(input: { credentials: Record<string, string> }): Promise<LanState>;
  api(input: { method: "GET" | "POST"; path: string; body?: unknown }): Promise<{ status: number; body: unknown }>;
  logout(): Promise<LanState>; forget(): Promise<LanState>;
}
const native = registerPlugin<LanNative>("OrionLan");
function requireAndroid() {
  if (!Capacitor.isNativePlatform()) throw new Error("Защищённое LAN-подключение доступно в Android-приложении.");
}
export async function lanRequest<T>(method: "GET" | "POST", path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  requireAndroid();
  const response = await native.api({ method, path, ...(body ? { body } : {}) });
  if (response.status < 200 || response.status >= 300) {
    const details = response.body as { code?: string; message?: string } | null;
    throw Object.assign(new Error(details?.code === "sync_mode_not_hybrid"
      ? "На компьютере включите гибридный режим этого пространства." : "Компьютер отклонил запрос. Проверьте доступ к пространству."),
    { status: response.status, details });
  }
  return schema.parse(response.body);
}
export const lan = {
  async discover() { requireAndroid(); return z.array(lanDiscoveredNodeSchema).max(32).parse((await native.discover()).nodes); },
  async reconnect(address: string, port: number) { requireAndroid(); return lanStateSchema.parse(await native.reconnect({ address, port })); },
  async state(): Promise<LanState> {
    if (!Capacitor.isNativePlatform()) return { paired: false, node: null, user: null, address: "", port: 4443 };
    return lanStateSchema.parse(await native.getState());
  },
  async begin(address: string, port: number) {
    requireAndroid();
    const result = await native.beginPairing({ address, port });
    return z.object({ code: z.string().regex(/^\d{6}$/), expiresAt: z.string(), node: lanNodeCardSchema, status: z.string() }).parse(result);
  },
  async poll() { requireAndroid(); return native.pollPairing(); },
  async accounts() {
    requireAndroid(); const response = await native.accounts();
    return response.status === 200 ? z.array(accountPublicSchema).parse(response.body) : [];
  },
  async login(credentials: Record<string, string>) { requireAndroid(); return lanStateSchema.parse(await native.login({ credentials })); },
  async workspaces() { return lanRequest("GET", "/workspaces/me", z.array(workspaceSchema)); },
  async mode(workspaceId: string) { return lanRequest("GET", "/workspaces/" + encodeURIComponent(workspaceId) + "/sync/mode", syncModeStateSchema); },
  async logout() { requireAndroid(); return lanStateSchema.parse(await native.logout()); },
  async forget() { requireAndroid(); return lanStateSchema.parse(await native.forget()); },
};
export const nativeSyncTransport: SyncTransport = {
  registerDevice: async (input) => { await lanRequest("POST", "/sync/devices", z.unknown(), input); },
  snapshot: async (workspaceId) => {
    const snapshot = await lanRequest("GET", "/workspaces/" + encodeURIComponent(workspaceId) + "/sync/replica", replicaSnapshotSchema);
    if (snapshot.workspaceId !== workspaceId) throw new Error("Компьютер вернул другое пространство");
    return snapshot;
  },
  pull: (workspaceId, cursor) => lanRequest("GET", "/workspaces/" + encodeURIComponent(workspaceId) + "/sync/replica/changes?cursor=" + encodeURIComponent(cursor), replicaPullSchema),
  push: (workspaceId, input) => lanRequest("POST", "/workspaces/" + encodeURIComponent(workspaceId) + "/sync/ops", pushSyncOpsResultSchema, input),
};
