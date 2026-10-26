// Prepare a feed only after verifying package identity and the previous signing key.
// Publishing remains a separate explicit step described in docs/android/UPDATES.md.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), args[index + 1]]);
  return pairs;
}, []));
for (const required of ["apk", "previous-apk", "notes", "out"]) {
  if (!options[required]) throw new Error("Required: --apk --previous-apk --notes --out");
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error("Set ANDROID_HOME");
const tools = path.join(sdk, "build-tools", "36.0.0");
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
function inspect(apk) {
  const badging = execFileSync(path.join(tools, process.platform === "win32" ? "aapt.exe" : "aapt"), ["dump", "badging", apk], { encoding: "utf8" });
  const match = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging);
  if (!match) throw new Error("Cannot read APK package/version");
  const signature = execFileSync(java, ["-jar", path.join(tools, "lib", "apksigner.jar"), "verify", "--print-certs", apk], { encoding: "utf8" });
  const signers = [...signature.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)/g)].map((value) => value[1]).sort();
  if (!signers.length) throw new Error("APK has no verified signer");
  return { applicationId: match[1], versionCode: Number(match[2]), versionName: match[3], signers };
}
const current = inspect(path.resolve(options.apk));
const previous = inspect(path.resolve(options["previous-apk"]));
if (current.applicationId !== "io.kaiden.orion.android" || current.applicationId !== previous.applicationId
  || current.versionCode <= previous.versionCode || JSON.stringify(current.signers) !== JSON.stringify(previous.signers)) {
  throw new Error("APK cannot update the previous installation");
}
const uiSource = await readFile("apps/android/src/updates.ts", "utf8");
const uiVersion = /ANDROID_VERSION = "([^"]+)"/.exec(uiSource)?.[1];
const uiCode = Number(/ANDROID_VERSION_CODE = (\d+)/.exec(uiSource)?.[1]);
const label = /ANDROID_RELEASE_LABEL = "(alpha\.\d+)"/.exec(uiSource)?.[1];
if (uiVersion !== current.versionName || uiCode !== current.versionCode || !label) throw new Error("UI/native version mismatch");
const tag = "v" + current.versionName + "-android-" + label;
const file = "KAIDEN-Orion-" + current.versionName + "-android-" + label + ".apk";
const size = (await stat(options.apk)).size;
if (size < 1 || size > 100 * 1024 * 1024) throw new Error("Unexpected APK size");
const sha256 = createHash("sha256").update(await readFile(options.apk)).digest("hex");
const notes = await readFile(options.notes, "utf8");
if (notes.length > 30000) throw new Error("Release notes too long");
const manifest = {
  schemaVersion: 1, applicationId: current.applicationId,
  versionCode: current.versionCode, versionName: current.versionName, tag, notes,
  publishedAt: new Date().toISOString(),
  apk: { url: "https://github.com/KeinReno/ORION-Android-Releases/releases/download/" + tag + "/" + file, size, sha256 },
};
await mkdir(options.out, { recursive: true });
await copyFile(options.apk, path.join(options.out, file));
await writeFile(path.join(options.out, "android-update.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(options.out, "SHA256SUMS.txt"), sha256 + "  " + file + "\n");
console.log(JSON.stringify({ tag, file, size, sha256, signer: current.signers, compatibleWith: previous.versionCode }, null, 2));
