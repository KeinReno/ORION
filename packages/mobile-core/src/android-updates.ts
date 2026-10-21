import { z } from "zod";

export const ANDROID_APP_ID = "io.kaiden.orion.android";
export const ANDROID_UPDATE_REPOSITORY = "KeinReno/ORION-Android-Releases";
export const androidUpdateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  applicationId: z.literal(ANDROID_APP_ID),
  versionCode: z.number().int().positive(),
  versionName: z.string().min(1).max(60),
  tag: z.string().regex(/^v\d+\.\d+\.\d+-android-alpha\.\d+$/),
  notes: z.string().max(30000),
  publishedAt: z.string().datetime(),
  apk: z.object({
    url: z.string().url(),
    size: z.number().int().positive().max(100 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
}).superRefine((manifest, context) => {
  const url = new URL(manifest.apk.url);
  const expected = "/" + ANDROID_UPDATE_REPOSITORY + "/releases/download/" + manifest.tag + "/";
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port
    || url.username || url.password || url.search || url.hash
    || !url.pathname.startsWith(expected)
    || !/^KAIDEN-Orion-[\w.-]+\.apk$/.test(url.pathname.slice(expected.length))
    || url.pathname.endsWith("-unsigned.apk")) {
    context.addIssue({ code: "custom", message: "Некорректный источник Android-обновления" });
  }
});
export type AndroidUpdateManifest = z.infer<typeof androidUpdateManifestSchema>;
export function isNewerAndroidUpdate(manifest: AndroidUpdateManifest, installedCode: number): boolean {
  return manifest.versionCode > installedCode;
}
