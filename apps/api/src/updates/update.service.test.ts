import { createHash, generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApplyScript } from "./apply-script";
import { builtinGithubUpdateToken } from "./builtin-github-token";
import { UpdateService } from "./update.service";

const TOKEN = "github_pat_0123456789abcdefghijklmnop";
const INSTALLER = Buffer.from("MZ-fake-installer-".repeat(1000));
const SHA = createHash("sha256").update(INSTALLER).digest("hex");

let server: Server;
let releases: Array<Record<string, unknown>>;
let assetBody: Buffer;
let seenAuth: string[];
let dir: string;

function payloadFixture(): Buffer {
  const runtime = path.join(dir, "shell-runtime");
  const put = (name: string, bytes: string | Buffer): void => { const file = path.join(runtime, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  const keys = generateKeyPairSync("ed25519");
  put("update-public-key.pem", keys.publicKey.export({ type: "spki", format: "pem" }));
  put("payload.cjs", fs.readFileSync(path.join(process.cwd(), "apps/desktop/runtime/payload.cjs")));
  put("build.json", JSON.stringify({ tag: "v0.1.0-windows-beta.2" }));
  put("shell-contract.json", '{"protocol":1,"nativeHash":"fixture","runtimeHash":"fixture"}');
  put("api/prisma/schema.prisma", "// fixture schema");
  const library = createRequire(path.join(process.cwd(), "package.json"))(path.join(runtime, "payload.cjs")) as { baseInfo: (root: string) => Record<string, unknown> };
  const contents: Record<string, string> = {
    "api/dist/main.js": "// no process is started", "api/package.json": "{}",
    "api/prisma/schema.prisma": "// fixture schema", "web/index.html": "<html>fixture</html>",
    "build.json": JSON.stringify({ tag: "v0.1.0-windows-beta.3" })
  };
  const files = Object.entries(contents).map(([name, bytes]) => ({ path: name, size: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") }));
  const manifest = Buffer.from(JSON.stringify({ ...library.baseInfo(runtime), tag: "v0.1.0-windows-beta.3", files }));
  const envelope = Buffer.from(JSON.stringify({ manifest: manifest.toString("base64"), signature: sign(null, manifest, keys.privateKey).toString("base64") }));
  const length = Buffer.alloc(4); length.writeUInt32BE(envelope.length);
  process.env.ORION_SHELL_RUNTIME = runtime;
  process.env.ORION_SHELL_BASE_TAG = "v0.1.0-windows-beta.2";
  return gzipSync(Buffer.concat([Buffer.from("ORION-PAYLOAD-1\n"), length, envelope, ...Object.values(contents).map(s => Buffer.from(s))]));
}

function release(tag: string, over: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: `ORION ${tag}`,
    body: `Заметки\n\nSHA-256 установщика: \`${SHA}\``,
    draft: false,
    prerelease: true,
    published_at: "2026-10-19T12:00:00Z",
    assets: [{ id: 7, name: "ORION_0.1.0_x64-setup.exe", size: INSTALLER.length }],
    ...over
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const auth = String(req.headers.authorization ?? "");
    seenAuth.push(auth);
    if (auth !== `Bearer ${TOKEN}`) return void res.writeHead(401).end("{}");
    const url = req.url ?? "";
    if (url.startsWith("/repos/o/r/releases?")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(releases));
    const tag = /^\/repos\/o\/r\/releases\/tags\/(.+)$/.exec(url);
    if (tag) {
      const found = releases.find((r) => r.tag_name === decodeURIComponent(tag[1]!));
      return void (found ? res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(found)) : res.writeHead(404).end("{}"));
    }
    if (url === "/repos/o/r/releases/assets/7") return void res.writeHead(302, { location: "/blob/7" }).end();
    if (url === "/blob/7") return void res.writeHead(200, { "content-type": "application/octet-stream", "content-length": assetBody.length }).end(assetBody);
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ORION_GITHUB_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.ORION_GITHUB_API_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-updates-"));
  process.env.ORION_NODE_DIR = dir;
  process.env.SYNC_SECRET = randomBytes(32).toString("base64");
  process.env.ORION_BUILD_TAG = "v0.1.0-windows-beta.2";
  delete process.env.ORION_EDITION;
  delete process.env.ORION_RUST_UPDATE_REPO;
  delete process.env.ORION_GITHUB_UPDATE_TOKEN;
  delete process.env.ORION_INSTALL_DIR;
  delete process.env.ORION_SHELL_RUNTIME;
  delete process.env.ORION_SHELL_BASE_TAG;
  releases = [release("v0.1.0-windows-beta.3"), release("v0.1.0-windows-beta.2")];
  assetBody = INSTALLER;
  seenAuth = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.ORION_NODE_DIR;
  delete process.env.ORION_BUILD_TAG;
  delete process.env.ORION_SHELL_RUNTIME;
  delete process.env.ORION_SHELL_BASE_TAG;
  delete process.env.ORION_PAYLOAD_ACK_FILE;
});

function configured(): UpdateService {
  const service = new UpdateService();
  service.setConfig({ repo: "o/r", token: TOKEN });
  return service;
}

describe("UpdateService", () => {
  it("выбирает совместимый лёгкий пакет без установщика и проверяет его подпись до ready", async () => {
    assetBody = payloadFixture();
    releases = [release("v0.1.0-windows-beta.3", { body: "small update", assets: [{ id: 7, name: "ORION_app_v0.1.0-windows-beta.2.orion.gz", size: assetBody.length }] })];
    const service = configured();
    expect((await service.check()).latest?.kind).toBe("payload");
    expect((await service.download()).state).toBe("ready");
    expect(fs.readdirSync(path.join(dir, "app-updates/versions"))).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "app-updates/state.json"))).toBe(false);
  });

  it("повреждённый лёгкий пакет не становится ready и не меняет выбранную версию", async () => {
    assetBody = payloadFixture();
    assetBody[assetBody.length - 20] ^= 1;
    releases = [release("v0.1.0-windows-beta.3", { assets: [{ id: 7, name: "ORION_app_v0.1.0-windows-beta.2.orion.gz", size: assetBody.length }] })];
    const service = configured(); await service.check();
    await expect(service.download()).rejects.toThrow();
    expect(service.getStatus().state).toBe("error");
    expect(fs.readdirSync(path.join(dir, "app-updates/versions"))).toHaveLength(0);
  });

  it("старый клиент игнорирует лёгкие релизы и выбирает полный установщик", async () => {
    releases.unshift(release("v0.1.0-windows-beta.4", { assets: [{ id: 8, name: "ORION_app_v0.1.0-windows-beta.2.orion.gz", size: 100 }] }));
    expect((await configured().check()).latest).toMatchObject({ tag: "v0.1.0-windows-beta.3", kind: "installer" });
  });

  it("готовность интерфейса подтверждается только для запущенной версии", () => {
    const service = configured();
    process.env.ORION_PAYLOAD_ACK_FILE = path.join(dir, "ack");
    expect(service.acknowledgeUi("different").accepted).toBe(false);
    expect(fs.existsSync(path.join(dir, "ack"))).toBe(false);
    fs.writeFileSync(path.join(dir, "ack"), "");
    expect(service.acknowledgeUi("v0.1.0-windows-beta.2").accepted).toBe(true);
  });
  it("без своего токена уходит встроенный, а сохранённый не возвращается и лежит зашифрованным", async () => {
    process.env.ORION_GITHUB_UPDATE_TOKEN = "github_pat_builtin_fixture_not_real";
    const service = new UpdateService();
    expect(service.getConfig().tokenSet).toBe(true);
    await expect(service.check()).rejects.toThrow("отклонил токен");
    expect(seenAuth[0]).toBe(`Bearer ${builtinGithubUpdateToken()}`);
    const config = service.setConfig({ repo: "o/r", token: TOKEN });
    expect(config).toEqual({ repo: "o/r", tokenSet: true, autoCheck: true });
    expect(JSON.stringify(config)).not.toContain(TOKEN);
    expect(fs.readFileSync(path.join(dir, "update-config.json"), "utf8")).not.toContain(TOKEN);
    expect(fs.readFileSync(path.join(dir, "update-config.json"), "utf8")).not.toContain(builtinGithubUpdateToken());
  });

  it("сборка ORION Rust не ставит релизы обычного ORION", async () => {
    process.env.ORION_EDITION = "rust";
    process.env.ORION_GITHUB_UPDATE_TOKEN = "github_pat_builtin_fixture_not_real";
    const service = new UpdateService();
    await expect(service.check()).rejects.toThrow("классической беты");
    expect(seenAuth).toEqual([]);
  });

  it("чужой репозиторий и уже скачанный установщик тоже не применяются в ORION Rust", async () => {
    const service = configured();
    await service.check();
    await service.download();
    const callsBefore = seenAuth.length;
    process.env.ORION_EDITION = "rust";
    await expect(service.download()).rejects.toThrow("свой канал");
    expect(seenAuth).toHaveLength(callsBefore);
    await expect(service.apply()).rejects.toThrow("свой канал");
    process.env.ORION_RUST_UPDATE_REPO = "o/r";
    await expect(service.check()).rejects.toThrow("не принадлежит");
  });

  it("находит более новый релиз, а для актуальной сборки говорит «последняя версия»", async () => {
    const service = configured();
    const status = await service.check();
    expect(status.state).toBe("available");
    expect(status.latest).toMatchObject({ tag: "v0.1.0-windows-beta.3", sha256: SHA, sizeBytes: INSTALLER.length });
    process.env.ORION_BUILD_TAG = "v0.1.0-windows-beta.3";
    expect((await service.check()).state).toBe("up_to_date");
  });

  it("неверный токен и недоступный репозиторий — понятные сообщения", async () => {
    const service = new UpdateService();
    service.setConfig({ repo: "o/r", token: "github_pat_wrong000000000000000000" });
    await expect(service.check()).rejects.toThrow("отклонил токен");
    service.setConfig({ repo: "o/nope", token: TOKEN });
    await expect(service.check()).rejects.toThrow("не найден");
  });

  it("скачивает установщик через перенаправление, проверяет размер и SHA-256 и переходит в «скачано»", async () => {
    const service = configured();
    await service.check();
    const status = await service.download();
    expect(status.state).toBe("ready");
    expect(status.progress).toBe(1);
    const file = fs.readdirSync(path.join(dir, "updates", "v0.1.0-windows-beta.3"));
    expect(file).toContain("ORION_0.1.0_x64-setup.exe");
    // Токен ушёл только GitHub: на адрес после перенаправления он отправляться не должен — здесь тот же хост, проверяем само скачивание.
    expect(seenAuth.every((value) => value === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("повреждённый файл отвергается и не остаётся на диске", async () => {
    const service = configured();
    await service.check();
    assetBody = Buffer.from("X".repeat(INSTALLER.length));
    await expect(service.download()).rejects.toThrow("Контрольная сумма");
    expect(fs.existsSync(path.join(dir, "updates", "v0.1.0-windows-beta.3", "ORION_0.1.0_x64-setup.exe"))).toBe(false);
    expect(service.getStatus().state).toBe("error");
  });

  it("релиз без контрольной суммы в описании не скачивается", async () => {
    releases = [release("v0.1.0-windows-beta.3", { body: "без суммы" })];
    const service = configured();
    await service.check();
    await expect(service.download()).rejects.toThrow("нет контрольной суммы");
  });

  it("применить нельзя без скачанного файла и вне установленной программы", async () => {
    const service = configured();
    await expect(service.apply()).rejects.toThrow("ещё не скачано");
    await service.check();
    await service.download();
    await expect(service.apply()).rejects.toThrow("только в установленной версии");
  });
});

describe("скрипт замены", () => {
  it("для проверенного пакета перезапускает приложение без запуска установщика", () => {
    const script = buildApplyScript({ installer: null, appExe: "C:\\ORION\\orion-desktop.exe", installDir: "C:\\ORION", logFile: "C:\\update.log" });
    expect(script).not.toContain("/S");
    expect(script).not.toContain("$installer");
    expect(script).toContain("Start-Process -FilePath 'C:\\ORION\\orion-desktop.exe'");
  });
  it("останавливает окно, базу и сервисы, ставит установщик тихо и запускает программу; кавычки в путях экранированы", () => {
    const script = buildApplyScript({
      installer: "C:\\Users\\O'Brien\\up\\ORION_setup.exe",
      appExe: "C:\\Users\\O'Brien\\AppData\\Local\\ORION\\orion-desktop.exe",
      installDir: "C:\\Users\\O'Brien\\AppData\\Local\\ORION",
      pgCtl: "C:\\pg\\bin\\pg_ctl.exe",
      cluster: "C:\\data\\postgres",
      logFile: "C:\\log.txt"
    });
    expect(script).toContain("Stop-Process -Force");
    expect(script).toContain("stop -D 'C:\\data\\postgres' -m fast -w");
    expect(script).toContain("-ArgumentList '/S' -PassThru -Wait");
    expect(script).toContain("'C:\\Users\\O''Brien\\up\\ORION_setup.exe'");
    expect(script.indexOf("pg_ctl")).toBeLessThan(script.indexOf("/S"));
    expect(script.trimEnd().endsWith("'обновление: программа запущена'")).toBe(true);
  });
});
