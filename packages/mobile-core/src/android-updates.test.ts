import { describe, expect, it } from "vitest";
import { androidUpdateManifestSchema, isNewerAndroidUpdate, mobileSettingsSchema, MobileRepository, type SnapshotStorage } from "./index";

const manifest = () => ({
  schemaVersion: 1, applicationId: "io.kaiden.orion.android",
  versionCode: 2, versionName: "0.1.1", tag: "v0.1.1-android-alpha.2",
  notes: "Новые настройки", publishedAt: "2026-10-21T08:00:00.000Z",
  apk: {
    url: "https://github.com/KeinReno/ORION-Android-Releases/releases/download/v0.1.1-android-alpha.2/KAIDEN-Orion-0.1.1-android-alpha.2.apk",
    size: 5000000, sha256: "a".repeat(64),
  },
});
describe("Android update boundary", () => {
  it("adds depth strength to existing settings without overriding the depth switch", () => {
    expect(mobileSettingsSchema.parse({ depthEffects: false })).toMatchObject({ depthEffects: false, depthStrength: 60 });
    for (const depthStrength of [-1, 101, 1.5, Number.NaN, "60"]) {
      expect(mobileSettingsSchema.safeParse({ depthStrength }).success).toBe(false);
    }
    expect(mobileSettingsSchema.parse({ depthStrength: 0 }).depthStrength).toBe(0);
    expect(mobileSettingsSchema.parse({ depthStrength: 100 }).depthStrength).toBe(100);
  });
  it("accepts only a newer version code, not a tag/title comparison", () => {
    const parsed = androidUpdateManifestSchema.parse(manifest());
    expect(isNewerAndroidUpdate(parsed, 1)).toBe(true);
    expect(isNewerAndroidUpdate(parsed, 2)).toBe(false);
    expect(isNewerAndroidUpdate(parsed, 3)).toBe(false);
  });
  it("rejects other apps, unsigned APKs and untrusted URLs", () => {
    const sources = [
      "http://github.com/KeinReno/ORION-Android-Releases/releases/download/v0.1.1-android-alpha.2/KAIDEN-Orion.apk",
      "https://github.com.evil.test/KeinReno/ORION-Android-Releases/releases/download/v0.1.1-android-alpha.2/KAIDEN-Orion.apk",
      "https://github.com/Other/ORION/releases/download/v0.1.1-android-alpha.2/KAIDEN-Orion.apk",
      manifest().apk.url.replace(".apk", "-unsigned.apk"),
      manifest().apk.url + "?token=secret", manifest().apk.url + "#fragment",
      manifest().apk.url.replace("https://", "https://user:pass@"),
    ];
    for (const url of sources) {
      const value = manifest(); value.apk.url = url;
      expect(androidUpdateManifestSchema.safeParse(value).success).toBe(false);
    }
    expect(androidUpdateManifestSchema.safeParse({ ...manifest(), applicationId: "other.app" }).success).toBe(false);
  });
  it("rejects mismatched tags, oversized packages and missing digests", () => {
    for (const change of [{ tag: "v0.1.1-windows-beta.2" }, { versionCode: 0 }, { versionCode: 1.5 }]) {
      expect(androidUpdateManifestSchema.safeParse({ ...manifest(), ...change }).success).toBe(false);
    }
    for (const change of [{ size: 101 * 1024 * 1024 }, { size: -1 }, { sha256: "" }]) {
      expect(androidUpdateManifestSchema.safeParse({ ...manifest(), apk: { ...manifest().apk, ...change } }).success).toBe(false);
    }
  });
  it("opens alpha.1 snapshots without changing content, outbox or device identity", async () => {
    let raw: string | null = null;
    const storage: SnapshotStorage = { read: async () => raw, write: async (value) => { raw = value; } };
    const first = await MobileRepository.open(storage);
    await first.saveEntry({ kind: "note", id: null, title: "Сохранить", body: "**Важный текст**", priority: "normal" });
    const before = first.snapshot();
    const legacy: Record<string, unknown> = JSON.parse(raw!); delete legacy.settings; raw = JSON.stringify(legacy);
    const updated = await MobileRepository.open(storage);
    expect(updated.snapshot()).toEqual({ ...before, settings: { depthEffects: true, depthStrength: 60, darkTheme: "kaiden-precision", theme: "system", autoCheckUpdates: true, downloadUpdatesOnWifi: false } });
    await updated.saveSettings({ theme: "light", autoCheckUpdates: false, downloadUpdatesOnWifi: true });
    const restarted = await MobileRepository.open(storage);
    expect(restarted.snapshot().notes).toEqual(before.notes);
    expect(restarted.snapshot().outbox).toEqual(before.outbox);
    expect(restarted.snapshot().settings).toEqual({ depthEffects: true, depthStrength: 60, darkTheme: "kaiden-precision", theme: "light", autoCheckUpdates: false, downloadUpdatesOnWifi: true });
  });
});
