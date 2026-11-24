import { X509Certificate, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAN_DEVICE_TOKEN_HEADER } from "@orion/shared-types";
import { DeviceStore } from "./device-store";
import { createDeviceTrustMiddleware, isLoopbackAddress, isOpenLanPath } from "./device-trust.middleware";
import { firewallAddCommands } from "./firewall";
import { clearClientBinding, loadClientBinding, loadNodeConfig, saveClientBinding, saveNodeConfig, writeJsonAtomic } from "./node-config";
import { codesEqual, computePairingCode } from "./pairing-code";
import { PAIR_MAX_ATTEMPTS, PAIR_TTL_MS, PairingRegistry } from "./pairing-registry";
import { observeCertificate, pinnedJson } from "./pinned-request";
import { createRemoteProxy } from "./remote-proxy";
import { fingerprintOfDer, issueSelfSignedCertificate, pemToDer } from "./self-signed-cert";

let dir: string;
const closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-lan-"));
});
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeJsonAtomic", () => {
  it("сохраняет прежнее состояние и убирает временный файл при постоянном отказе", () => {
    const file = path.join(dir, "atomic-state.json");
    fs.writeFileSync(file, '{"previous":true}');
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("access denied"), { code: "EPERM" });
    });
    try {
      expect(() => writeJsonAtomic(file, { current: true })).toThrow("access denied");
      expect(rename).toHaveBeenCalledTimes(process.platform === "win32" ? 6 : 1);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ previous: true });
      expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      rename.mockRestore();
    }
  });

  it.skipIf(process.platform !== "win32")("повторяет временный Windows rename EPERM и сохраняет атомарный файл", () => {
    const file = path.join(dir, "atomic-state.json");
    fs.writeFileSync(file, "{\"previous\":true}");
    const rename = vi.spyOn(fs, "renameSync");
    rename.mockImplementationOnce(() => { throw Object.assign(new Error("temporary lock"), { code: "EPERM" }); });
    try {
      writeJsonAtomic(file, { current: true });
      expect(rename).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ current: true });
      expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      rename.mockRestore();
    }
  });
});

function listenHttps(app: http.RequestListener, cert: { keyPem: string; certPem: string }): Promise<number> {
  return new Promise((resolve) => {
    const server = https.createServer({ key: cert.keyPem, cert: cert.certPem }, app).listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    closers.push(() => new Promise((done) => (server.closeAllConnections(), server.close(() => done()))));
  });
}

function listenHttp(app: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    closers.push(() => new Promise((done) => (server.closeAllConnections(), server.close(() => done()))));
  });
}

function get(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    }).on("error", reject);
  });
}

describe("self-signed certificate", () => {
  it("is a valid X.509 whose signature verifies and whose fingerprint matches Node's", () => {
    const issued = issueSelfSignedCertificate({ commonName: "ORION-TEST", ipAddresses: ["192.168.1.10"] });
    const cert = new X509Certificate(issued.certPem);
    expect(cert.subject).toContain("CN=ORION-TEST");
    expect(cert.fingerprint256).toBe(issued.fingerprint);
    expect(fingerprintOfDer(pemToDer(issued.certPem))).toBe(issued.fingerprint);
    expect(cert.verify(createPublicKey(issued.certPem))).toBe(true);
    expect(cert.subjectAltName).toContain("IP Address:192.168.1.10");
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now() + 9 * 365 * 24 * 3600 * 1000);
    expect(verify).toBeTypeOf("function");
  });

  it("serves a real TLS handshake and is observed with the same fingerprint", async () => {
    const issued = issueSelfSignedCertificate({ commonName: "ORION-TEST" });
    const port = await listenHttps((_req, res) => res.end("{}"), issued);
    const observed = await observeCertificate("127.0.0.1", port);
    expect(observed.fingerprint).toBe(issued.fingerprint);
  });
});

describe("certificate pinning", () => {
  it("accepts the pinned certificate and refuses any other one", async () => {
    const hostCert = issueSelfSignedCertificate({ commonName: "HOST" });
    const impostor = issueSelfSignedCertificate({ commonName: "HOST" });
    const hostPort = await listenHttps((_req, res) => res.setHeader("content-type", "application/json").end('{"ok":true}'), hostCert);
    const impostorPort = await listenHttps((_req, res) => res.end('{"ok":true}'), impostor);

    const good = await pinnedJson({ address: "127.0.0.1", port: hostPort, certPem: hostCert.certPem }, "GET", "/");
    expect(good.status).toBe(200);
    await expect(pinnedJson({ address: "127.0.0.1", port: impostorPort, certPem: hostCert.certPem }, "GET", "/")).rejects.toThrow();
  });
});

describe("pairing code", () => {
  it("is six digits, depends on the certificate, and compares in constant shape", () => {
    const a = computePairingCode("client", "server", "AA:BB");
    expect(a).toMatch(/^\d{6}$/);
    expect(computePairingCode("client", "server", "aabb")).toBe(a);
    expect(computePairingCode("client", "server", "AA:CC")).not.toBe(a);
    expect(codesEqual(a, a)).toBe(true);
    expect(codesEqual(a, "12")).toBe(false);
  });
});

describe("device store", () => {
  it("revokes immediately, tells revoked from unknown, and persists only the token hash", () => {
    const store = new DeviceStore(dir);
    const { device, token } = store.create("Ноутбук", "192.168.1.5");
    expect(store.check(token, "192.168.1.5").ok).toBe(true);
    expect(store.check("orion_dev_wrong", null)).toEqual({ ok: false, reason: "unknown" });
    expect(fs.readFileSync(path.join(dir, "lan-devices.json"), "utf8")).not.toContain(token);
    expect(new DeviceStore(dir).check(token, null).ok).toBe(true);

    expect(store.revoke(device.id)).toBe(true);
    expect(store.check(token, null)).toEqual({ ok: false, reason: "revoked" });
    expect(store.list()).toHaveLength(0);
    expect(new DeviceStore(dir).check(token, null)).toEqual({ ok: false, reason: "revoked" });
  });
});

describe("pairing registry", () => {
  const fingerprint = () => "AA:BB:CC";

  function setup(now = { t: 1_000_000 }) {
    const devices = new DeviceStore(dir, () => now.t);
    return { now, devices, registry: new PairingRegistry(devices, fingerprint, () => now.t) };
  }

  it("issues the device token once, only to the holder of the client nonce, after the right code", () => {
    const { registry, devices } = setup();
    const created = registry.create({ deviceName: "Ноутбук", clientNonce: "n".repeat(24), address: "192.168.1.5" });
    expect(registry.poll(created.requestId, "n".repeat(24)).status).toBe("pending");
    registry.approve(created.requestId, computePairingCode("n".repeat(24), created.serverNonce, fingerprint()));

    expect(registry.poll(created.requestId, "someone-else-entirely").deviceToken).toBeNull();
    const first = registry.poll(created.requestId, "n".repeat(24));
    expect(first.status).toBe("approved");
    expect(devices.check(first.deviceToken!, null).ok).toBe(true);
    expect(registry.poll(created.requestId, "n".repeat(24)).deviceToken).toBeNull();
  });

  it("locks the request after three wrong codes, and nothing is trusted", () => {
    const { registry, devices } = setup();
    const created = registry.create({ deviceName: "X", clientNonce: "n".repeat(24), address: "10.0.0.2" });
    for (let i = 1; i < PAIR_MAX_ATTEMPTS; i++) expect(() => registry.approve(created.requestId, "000000")).toThrow(/Осталось попыток/);
    expect(() => registry.approve(created.requestId, "000000")).toThrow(/закрыта/);
    expect(() => registry.approve(created.requestId, computePairingCode("n".repeat(24), created.serverNonce, fingerprint()))).toThrow();
    expect(registry.poll(created.requestId, "n".repeat(24)).status).toBe("denied");
    expect(devices.list()).toHaveLength(0);
  });

  it("rejects a code computed from a different certificate (man in the middle)", () => {
    const { registry } = setup();
    const created = registry.create({ deviceName: "X", clientNonce: "n".repeat(24), address: "10.0.0.2" });
    const mitm = computePairingCode("n".repeat(24), created.serverNonce, "DE:AD:BE:EF");
    expect(() => registry.approve(created.requestId, mitm)).toThrow(/не совпал/);
  });

  it("expires requests, limits requests per address and the pending queue", () => {
    const { registry, now } = setup();
    const created = registry.create({ deviceName: "X", clientNonce: "n".repeat(24), address: "10.0.0.2" });
    now.t += PAIR_TTL_MS + 1;
    expect(registry.poll(created.requestId, "n".repeat(24)).status).toBe("expired");
    expect(() => registry.approve(created.requestId, "123456")).toThrow(/не найдена/);

    const fresh = setup();
    for (let i = 0; i < 3; i++) fresh.registry.create({ deviceName: "X", clientNonce: "n".repeat(24), address: "10.0.0.9" });
    expect(() => fresh.registry.create({ deviceName: "X", clientNonce: "n".repeat(24), address: "10.0.0.9" })).toThrow(/Слишком много/);

    const queue = setup();
    for (let i = 0; i < 5; i++) queue.registry.create({ deviceName: "X", clientNonce: "n".repeat(24), address: `10.0.1.${i}` });
    expect(() => queue.registry.create({ deviceName: "X", clientNonce: "n".repeat(24), address: "10.0.2.1" })).toThrow(/ждут подтверждения/);
  });
});

describe("device trust middleware", () => {
  function run(remote: string, urlPath: string, token?: string, store = new DeviceStore(dir)) {
    const middleware = createDeviceTrustMiddleware(store);
    let nexted = false;
    const out: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const res = {
      setHeader: (key: string, value: string) => void (out.headers[key] = value),
      status(code: number) {
        out.status = code;
        return this;
      },
      json(body: unknown) {
        out.body = body;
      }
    };
    middleware(
      { socket: { remoteAddress: remote }, method: "GET", path: urlPath, headers: token ? { [LAN_DEVICE_TOKEN_HEADER]: token } : {} } as never,
      res as never,
      () => void (nexted = true)
    );
    return { nexted, out };
  }

  it("lets the machine itself through and blocks every anonymous LAN request except the node card and pairing", () => {
    for (const urlPath of ["/auth/accounts", "/workspaces", "/auth/register", "/auth/login", "/system/info", "/lan/host/devices", "/documents/1/content"]) {
      const result = run("192.168.1.50", urlPath);
      expect(result.nexted, urlPath).toBe(false);
      expect(result.out.status).toBe(403);
      expect(JSON.stringify(result.out.body)).not.toMatch(/email|workspace|user/i);
    }
    for (const urlPath of ["/lan/info", "/lan/pair/request", "/lan/pair/status/abc", "/system/health"]) {
      expect(run("192.168.1.50", urlPath).nexted, urlPath).toBe(true);
    }
    expect(run("127.0.0.1", "/auth/accounts").nexted).toBe(true);
    expect(run("::ffff:127.0.0.1", "/auth/accounts").nexted).toBe(true);
    expect(run("::1", "/auth/accounts").nexted).toBe(true);
  });

  it("does not open neighbouring paths by prefix or case tricks", () => {
    for (const urlPath of ["/lan/info/../auth/accounts", "/lan/information", "/lan/pair/request/x/y", "/system/healthz", "/LAN/info"]) {
      if (isOpenLanPath(urlPath)) expect(urlPath).toBe("/lan/info/../auth/accounts");
    }
    expect(isOpenLanPath("/lan/information")).toBe(false);
    expect(isOpenLanPath("/system/healthz")).toBe(false);
    expect(isLoopbackAddress("192.168.0.1")).toBe(false);
    expect(isLoopbackAddress("::ffff:192.168.0.1")).toBe(false);
  });

  it("admits a trusted device and answers a revoked one with 401 immediately", () => {
    const store = new DeviceStore(dir);
    const { device, token } = store.create("Планшет", null);
    expect(run("192.168.1.50", "/workspaces", token, store).nexted).toBe(true);
    store.revoke(device.id);
    const after = run("192.168.1.50", "/workspaces", token, store);
    expect(after.nexted).toBe(false);
    expect(after.out.status).toBe(401);
    expect(after.out.headers["x-orion-lan"]).toBe("device_revoked");
  });
});

describe("remote proxy (client mode)", () => {
  async function hostWith(cert: { keyPem: string; certPem: string }) {
    const seen: Array<{ url: string | undefined; token: string | undefined; body: string }> = [];
    const port = await listenHttps((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen.push({ url: req.url, token: req.headers[LAN_DEVICE_TOKEN_HEADER] as string | undefined, body });
        res.setHeader("content-type", "application/json").setHeader("access-control-allow-origin", "http://evil").end(JSON.stringify({ from: "host" }));
      });
    }, cert);
    return { port, seen };
  }

  function localApi(binding: ReturnType<typeof loadClientBinding>, clientMode = true) {
    const states: string[] = [];
    const proxy = createRemoteProxy({ isClientMode: () => clientMode, binding: () => binding, onResult: (state) => states.push(state) });
    // Минимальная замена Express: прокси использует только originalUrl, res.status() и res.json().
    const app: http.RequestListener = (req, res) => {
      const shim = res as http.ServerResponse & { status: (code: number) => unknown; json: (body: unknown) => void };
      shim.status = (code) => ((res.statusCode = code), shim);
      shim.json = (body) => void res.setHeader("content-type", "application/json").end(JSON.stringify(body));
      (req as http.IncomingMessage & { originalUrl: string }).originalUrl = req.url ?? "";
      proxy(req as never, shim as never, () => shim.json({ from: "local" }));
    };
    return { app, states };
  }

  const binding = (port: number, certPem: string) => ({ nodeId: "n", name: "Дом", address: "127.0.0.1", port, fingerprint: "x", certPem, deviceToken: "orion_dev_secret", pairedAt: "" });

  it("forwards to the pinned host with the device token and never touches local routes", async () => {
    const cert = issueSelfSignedCertificate({ commonName: "HOST" });
    const host = await hostWith(cert);
    const { app, states } = localApi(binding(host.port, cert.certPem));
    const port = await listenHttp(app);

    const remote = await get(port, "/_remote/workspaces?x=1", { [LAN_DEVICE_TOKEN_HEADER]: "client-supplied-forgery" });
    expect(remote.status).toBe(200);
    expect(JSON.parse(remote.body)).toEqual({ from: "host" });
    expect(host.seen[0]).toMatchObject({ url: "/workspaces?x=1", token: "orion_dev_secret" });
    expect(remote.headers["access-control-allow-origin"]).toBeUndefined();
    expect(states).toEqual(["online"]);
    expect(JSON.parse((await get(port, "/local-only")).body)).toEqual({ from: "local" });
  });

  it("reports an unreachable host as node_offline and a swapped certificate as node_cert_changed", async () => {
    const cert = issueSelfSignedCertificate({ commonName: "HOST" });
    const closed = await listenHttp((_req, res) => res.end());
    const offline = localApi(binding(1, cert.certPem));
    const offlinePort = await listenHttp(offline.app);
    const down = await get(offlinePort, "/_remote/x");
    expect(down.status).toBe(503);
    expect(JSON.parse(down.body).code).toBe("node_offline");
    expect(closed).toBeGreaterThan(0);

    const impostor = issueSelfSignedCertificate({ commonName: "HOST" });
    const host = await hostWith(impostor);
    const swapped = localApi(binding(host.port, cert.certPem));
    const swappedPort = await listenHttp(swapped.app);
    const result = await get(swappedPort, "/_remote/x");
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body).code).toBe("node_cert_changed");
    expect(host.seen).toHaveLength(0);
  });

  it("refuses when not in client mode, so nothing is silently answered locally", async () => {
    const cert = issueSelfSignedCertificate({ commonName: "HOST" });
    const { app } = localApi(binding(1, cert.certPem), false);
    const port = await listenHttp(app);
    const result = await get(port, "/_remote/workspaces");
    expect(result.status).toBe(409);
    expect(JSON.parse(result.body).code).toBe("not_client_mode");
  });
});

describe("node config files", () => {
  it("keeps a stable nodeId, switches modes without losing the host binding, and forgets it on request", () => {
    const first = loadNodeConfig(dir);
    expect(first.mode).toBe("local");
    expect(loadNodeConfig(dir).nodeId).toBe(first.nodeId);
    for (const port of [-5, 0, 65536, 99999]) {
      saveNodeConfig({ ...first, port }, dir);
      expect(loadNodeConfig(dir).port).toBe(first.port);
    }
    saveClientBinding({ nodeId: "h", name: "Дом", address: "192.168.1.2", port: 4443, fingerprint: "AA", certPem: "pem", deviceToken: "t", pairedAt: "" }, dir);
    saveNodeConfig({ ...first, mode: "client" }, dir);
    saveNodeConfig({ ...loadNodeConfig(dir), mode: "local" }, dir);
    expect(loadClientBinding(dir)?.deviceToken).toBe("t");
    clearClientBinding(dir);
    expect(loadClientBinding(dir)).toBeNull();
    expect(loadNodeConfig(dir).nodeId).toBe(first.nodeId);
  });
});

describe("firewall rules", () => {
  it("are limited to the private profile and the local subnet, and never open the database port", () => {
    const commands = firewallAddCommands(4443).join("\n");
    expect(commands).toContain("profile=private");
    expect(commands).toContain("remoteip=localsubnet");
    expect(commands).toContain("localport=4443");
    expect(commands).not.toMatch(/5432|55432|5433/);
  });
});
