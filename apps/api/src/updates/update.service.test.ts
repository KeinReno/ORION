import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApplyScript } from "./apply-script";
import { UpdateService } from "./update.service";

const TOKEN = "github_pat_0123456789abcdefghijklmnop";
const INSTALLER = Buffer.from("MZ-fake-installer-".repeat(1000));
const SHA = createHash("sha256").update(INSTALLER).digest("hex");

let server: Server;
let releases: Array<Record<string, unknown>>;
let assetBody: Buffer;
let seenAuth: string[];
let dir: string;

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
  delete process.env.ORION_INSTALL_DIR;
  releases = [release("v0.1.0-windows-beta.3"), release("v0.1.0-windows-beta.2")];
  assetBody = INSTALLER;
  seenAuth = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.ORION_NODE_DIR;
  delete process.env.ORION_BUILD_TAG;
});

function configured(): UpdateService {
  const service = new UpdateService();
  service.setConfig({ repo: "o/r", token: TOKEN });
  return service;
}

describe("UpdateService", () => {
  it("без токена проверка отказывает, а токен не возвращается и хранится зашифрованным", async () => {
    const service = new UpdateService();
    await expect(service.check()).rejects.toThrow("Токен GitHub не задан");
    const config = service.setConfig({ repo: "o/r", token: TOKEN });
    expect(config).toEqual({ repo: "o/r", tokenSet: true, autoCheck: true });
    expect(JSON.stringify(config)).not.toContain(TOKEN);
    expect(fs.readFileSync(path.join(dir, "update-config.json"), "utf8")).not.toContain(TOKEN);
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
    expect(() => service.apply()).toThrow("ещё не скачано");
    await service.check();
    await service.download();
    expect(() => service.apply()).toThrow("только в установленной версии");
  });
});

describe("скрипт замены", () => {
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
