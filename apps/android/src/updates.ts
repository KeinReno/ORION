import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { androidUpdateManifestSchema, ANDROID_UPDATE_REPOSITORY, type AndroidUpdateManifest } from "@orion/mobile-core";

export const ANDROID_VERSION = "0.1.8";
export const ANDROID_VERSION_CODE = 9;
export const ANDROID_RELEASE_LABEL = "alpha.9";
export const UPDATE_FEED = "https://raw.githubusercontent.com/" + ANDROID_UPDATE_REPOSITORY + "/main/android-update.json";

export interface UpdateState {
  installedVersion: string;
  installedCode: number;
  lastChecked: number;
  lastAttempt: number;
  available: boolean;
  ready: boolean;
  downloading: boolean;
  canInstall: boolean;
  wifi: boolean;
  manifest: AndroidUpdateManifest | null;
}
interface NativeUpdater {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(options: { wifiOnly: boolean }): Promise<UpdateState>;
  install(): Promise<{ status: "permission" | "installer" }>;
  addListener(event: "downloadProgress", listener: (progress: { received: number; total: number }) => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<NativeUpdater>("OrionUpdates");
const browserState: UpdateState = {
  installedVersion: ANDROID_VERSION, installedCode: ANDROID_VERSION_CODE,
  lastChecked: 0, lastAttempt: 0, available: false, ready: false,
  downloading: false, canInstall: false, wifi: false, manifest: null,
};
function validate(state: UpdateState): UpdateState {
  return { ...state, manifest: state.manifest ? androidUpdateManifestSchema.parse(state.manifest) : null };
}
export const updater = {
  async getState() { return Capacitor.isNativePlatform() ? validate(await native.getState()) : { ...browserState }; },
  async check() {
    if (Capacitor.isNativePlatform()) return validate(await native.check());
    browserState.lastAttempt = Date.now();
    const response = await fetch(UPDATE_FEED, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Не удалось проверить обновления. Проверьте интернет и повторите.");
    const raw = await response.text();
    if (raw.length > 65536) throw new Error("Источник обновлений вернул некорректные данные");
    const manifest = androidUpdateManifestSchema.parse(JSON.parse(raw));
    browserState.lastChecked = Date.now();
    browserState.available = manifest.versionCode > ANDROID_VERSION_CODE;
    browserState.manifest = browserState.available ? manifest : null;
    return { ...browserState };
  },
  async download(wifiOnly: boolean) {
    if (!Capacitor.isNativePlatform()) throw new Error("Загрузка и установка доступны в Android-приложении.");
    return validate(await native.download({ wifiOnly }));
  },
  async install() {
    if (!Capacitor.isNativePlatform()) throw new Error("Установка доступна в Android-приложении.");
    return native.install();
  },
  async listen(listener: (progress: { received: number; total: number }) => void) {
    return Capacitor.isNativePlatform() ? native.addListener("downloadProgress", listener) : { remove: async () => {} };
  },
};
